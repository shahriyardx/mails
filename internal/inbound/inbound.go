// Package inbound stores mail the Cloudflare Email Worker hands over at
// POST /api/inbound, and answers where the worker should forward it.
//
// The worker signs each request with HMAC-SHA256 over "timestamp.body" using
// INBOUND_WEBHOOK_SECRET; nothing else can inject mail. The payload shape is
// fixed by worker/src/index.ts (see worker/PAYLOAD.md).
package inbound

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/db"
	"github.com/shahriyardx/mails/internal/events"
	"github.com/shahriyardx/mails/internal/forwarding"
	"github.com/shahriyardx/mails/internal/id"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/realtime"
)

// Payload is the "email" object the worker posts.
type Payload struct {
	To          string         `json:"to"`
	Recipients  []string       `json:"recipients"`
	From        addr.Address   `json:"from"`
	ToAddresses []addr.Address `json:"toAddresses"`
	CcAddresses []addr.Address `json:"ccAddresses"`
	ReplyTo     *string        `json:"replyTo"`
	Subject     string         `json:"subject"`
	Text        *string        `json:"text"`
	HTML        *string        `json:"html"`
	MessageID   *string        `json:"messageId"`
	InReplyTo   *string        `json:"inReplyTo"`
	References  []string       `json:"references"`
	Date        *string        `json:"date"`
	SizeBytes   int            `json:"sizeBytes"`
	RawKey      *string        `json:"rawKey"`
	Auth        struct {
		SPF   *string `json:"spf"`
		DKIM  *string `json:"dkim"`
		DMARC *string `json:"dmarc"`
	} `json:"auth"`
	SpamScore *int    `json:"spamScore"`
	MailedBy  *string `json:"mailedBy"`
	SignedBy  *string `json:"signedBy"`
	TLS       *string `json:"tls"`
}

// Attachment is a file the worker already put in R2.
type Attachment struct {
	Filename    string  `json:"filename"`
	ContentType string  `json:"contentType"`
	SizeBytes   int     `json:"sizeBytes"`
	R2Key       string  `json:"r2Key"`
	ContentID   *string `json:"contentId"`
	IsInline    bool    `json:"isInline"`
}

// Received describes one stored message, for hooks (push, webhooks).
type Received struct {
	MessageID   string
	ThreadID    string
	MailboxID   string
	Mailbox     string
	DeliveredTo string
	From        addr.Address
	Subject     string
	Folder      string
}

// Result is what Ingest did. Stored is empty when no mailbox took the mail.
type Result struct {
	Stored  []string
	Forward []string
}

// Service stores inbound mail.
type Service struct {
	DB  *pgxpool.Pool
	Hub *realtime.Hub
	Now func() time.Time
	// OnReceived runs after each stored message commits. Hooks must not
	// block: anything slow (a push service) goes in its own goroutine.
	OnReceived []func(context.Context, Received)
	// Events gets mail.received for webhooks.
	Events events.Sink
}

type mailboxRow struct {
	ID      string
	Address string
}

// Ingest stores the message once per recipient mailbox and works out where
// the worker should forward it.
func (s *Service) Ingest(ctx context.Context, p *Payload, files []Attachment) (Result, error) {
	recipients := p.Recipients
	if len(recipients) == 0 && p.To != "" {
		recipients = []string{p.To}
	}
	p.From.Address = strings.ToLower(strings.TrimSpace(p.From.Address))

	var res Result
	var delivered []string
	for _, to := range dedupe(recipients) {
		box, err := s.resolveMailbox(ctx, to)
		if err != nil {
			return res, err
		}
		if box == nil {
			continue
		}
		delivered = append(delivered, box.ID)
		r, dup, err := s.store(ctx, box, to, p, files)
		if err != nil {
			return res, err
		}
		res.Stored = append(res.Stored, r.MessageID)
		// Announce right after this mailbox's commit: if a later recipient
		// fails and the worker retries, this one is a duplicate then and
		// would never be announced.
		if !dup {
			s.Hub.Publish(realtime.Event{Type: "mail.received", Data: map[string]string{
				"thread_id": r.ThreadID, "mailbox_id": r.MailboxID, "message_id": r.MessageID,
			}})
			for _, hook := range s.OnReceived {
				hook(ctx, r)
			}
			s.emitReceived(ctx, r, p, len(files) > 0)
		}
	}

	// Forwarding is answered even for duplicates: the worker forwards once
	// per delivery attempt, and the rules are the same either way.
	seen := map[string]bool{}
	add := func(list []string) {
		for _, a := range list {
			if !seen[a] {
				seen[a] = true
				res.Forward = append(res.Forward, a)
			}
		}
	}
	for _, mailboxID := range delivered {
		targets, err := forwarding.ForMailbox(ctx, s.DB, mailboxID)
		if err != nil {
			return res, err
		}
		add(targets)
	}
	if len(delivered) == 0 {
		for _, to := range recipients {
			targets, err := forwarding.ForUnknown(ctx, s.DB, to)
			if err != nil {
				return res, err
			}
			add(targets)
		}
	}
	res.Forward = removeOwn(ctx, s.DB, res.Forward)
	return res, nil
}

// emitReceived fires mail.received with the documented payload.
func (s *Service) emitReceived(ctx context.Context, r Received, p *Payload, hasFiles bool) {
	if s.Events == nil {
		return
	}
	to := p.ToAddresses
	if to == nil {
		to = []addr.Address{}
	}
	s.Events.Emit(ctx, events.Event{Type: "mail.received", MailboxID: r.MailboxID, Data: map[string]any{"email": map[string]any{
		"id": r.MessageID, "thread_id": r.ThreadID, "mailbox_id": r.MailboxID, "mailbox": r.Mailbox,
		"message_id": p.MessageID, "from": p.From, "to": to, "delivered_to": r.DeliveredTo, "subject": r.Subject,
		"snippet": addr.Snippet(deref(p.Text), deref(p.HTML)), "folder": r.Folder, "has_attachments": hasFiles,
		"spf": p.Auth.SPF, "dkim": p.Auth.DKIM, "dmarc": p.Auth.DMARC, "spam_score": p.SpamScore,
		"mailed_by": p.MailedBy, "signed_by": p.SignedBy, "tls": p.TLS, "received_at": s.receivedAt(p.Date),
	}}})
}

// removeOwn drops forward targets on our own domains: forwarding there
// would send the message straight back in, forever.
func removeOwn(ctx context.Context, q db.Querier, list []string) []string {
	if len(list) == 0 {
		return list
	}
	rows, _ := q.Query(ctx, `SELECT name FROM domain`)
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		slog.Error("load domains for forward loop check", "err", err)
		return nil // the safe failure is forwarding nowhere
	}
	out := list[:0]
	for _, a := range list {
		if addr.Covering(a, names) < 0 {
			out = append(out, a)
		}
	}
	return out
}

// resolveMailbox finds the mailbox for a delivered address: exact match,
// then the domain's catch-all, then (if the domain asks) a new mailbox.
func (s *Service) resolveMailbox(ctx context.Context, address string) (*mailboxRow, error) {
	address = strings.ToLower(strings.TrimSpace(address))
	domain := addr.DomainOf(address)
	var m mailboxRow
	err := s.DB.QueryRow(ctx, `SELECT id, address FROM mailbox
		WHERE address = $1 OR (domain = $2 AND is_catch_all)
		ORDER BY address = $1 DESC, created_at LIMIT 1`, address, domain).Scan(&m.ID, &m.Address)
	if err == nil {
		return &m, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("resolve mailbox: %w", err)
	}
	var domainID string
	err = s.DB.QueryRow(ctx, `SELECT id FROM domain WHERE name = $1 AND auto_create_mailboxes`, domain).Scan(&domainID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("auto-create lookup: %w", err)
	}
	// Two messages to a new address can arrive at once.
	_, err = s.DB.Exec(ctx, `INSERT INTO mailbox (id, address, domain, domain_id, display_name, color)
		VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (address) DO NOTHING`,
		id.New("mbx"), address, domain, domainID, addr.LocalOf(address), addr.Color(address))
	if err != nil {
		return nil, fmt.Errorf("auto-create mailbox: %w", err)
	}
	err = s.DB.QueryRow(ctx, `SELECT id, address FROM mailbox WHERE address = $1`, address).Scan(&m.ID, &m.Address)
	if err != nil {
		return nil, fmt.Errorf("load auto-created mailbox: %w", err)
	}
	return &m, nil
}

// store writes one message for one mailbox in a transaction. dup is true
// when this mailbox already has a message with the same Message-ID.
func (s *Service) store(ctx context.Context, box *mailboxRow, deliveredTo string, p *Payload, files []Attachment) (r Received, dup bool, err error) {
	subject := strings.TrimSpace(p.Subject)
	receivedAt := s.receivedAt(p.Date)
	text, html := deref(p.Text), deref(p.HTML)

	// A message that fails DMARC, or that a trusted hop scored as spam,
	// starts in spam. Filters may still move it.
	folder := "inbox"
	if (p.SpamScore != nil && *p.SpamScore >= 5) || (p.Auth.DMARC != nil && *p.Auth.DMARC == "fail") {
		folder = "spam"
	}

	r = Received{MailboxID: box.ID, Mailbox: box.Address, DeliveredTo: deliveredTo, From: p.From, Subject: subject}
	err = pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if p.MessageID != nil && *p.MessageID != "" {
			err := tx.QueryRow(ctx, `SELECT id, thread_id FROM message WHERE mailbox_id = $1 AND rfc_message_id = $2`,
				box.ID, *p.MessageID).Scan(&r.MessageID, &r.ThreadID)
			if err == nil {
				dup = true
				return nil
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("dedupe: %w", err)
			}
		}

		act, err := applyFilters(ctx, tx, p, folder)
		if err != nil {
			return err
		}
		r.Folder = act.folder

		r.ThreadID, err = findThread(ctx, tx, box.ID, p, addr.NormalizeSubject(subject))
		if err != nil {
			return err
		}
		if r.ThreadID == "" {
			r.ThreadID = id.New("thr")
			if _, err := tx.Exec(ctx, `INSERT INTO thread (id, mailbox_id, subject, last_message_at) VALUES ($1, $2, $3, $4)`,
				r.ThreadID, box.ID, subject, receivedAt); err != nil {
				return fmt.Errorf("insert thread: %w", err)
			}
		}

		r.MessageID = id.New("msg")
		var fromName *string
		if p.From.Name != "" {
			fromName = &p.From.Name
		}
		tag, err := tx.Exec(ctx, `INSERT INTO message (id, thread_id, mailbox_id, rfc_message_id, in_reply_to, "references",
				from_name, from_address, to_addrs, cc_addrs, reply_to, subject, snippet, text_body, html_body, folder,
				is_read, is_starred, spf, dkim, dmarc, spam_score, mailed_by, signed_by, tls, size_bytes, raw_key, sent_at, received_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $28)
			ON CONFLICT (mailbox_id, rfc_message_id) DO NOTHING`,
			r.MessageID, r.ThreadID, box.ID, p.MessageID, p.InReplyTo, nonNil(p.References),
			fromName, p.From.Address, nonNilAddrs(p.ToAddresses), nonNilAddrs(p.CcAddresses), p.ReplyTo, subject,
			addr.Snippet(text, html), p.Text, p.HTML, act.folder, act.markRead, act.star,
			p.Auth.SPF, p.Auth.DKIM, p.Auth.DMARC, p.SpamScore, p.MailedBy, p.SignedBy, p.TLS, p.SizeBytes, p.RawKey, receivedAt)
		if err != nil {
			return fmt.Errorf("insert message: %w", err)
		}
		if tag.RowsAffected() == 0 {
			// The same message arrived twice at once; the other copy won.
			// Recompute drops the thread if this attempt just made it.
			dup, r.MessageID = true, ""
			return mail.Recompute(ctx, tx, r.ThreadID)
		}

		for _, f := range files {
			ct := f.ContentType
			if ct == "" {
				ct = "application/octet-stream"
			}
			if _, err := tx.Exec(ctx, `INSERT INTO attachment (id, message_id, filename, content_type, size_bytes, r2_key, content_id, is_inline)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
				id.New("att"), r.MessageID, f.Filename, ct, f.SizeBytes, f.R2Key, f.ContentID, f.IsInline); err != nil {
				return fmt.Errorf("insert attachment: %w", err)
			}
		}
		for _, labelID := range act.labels {
			if _, err := tx.Exec(ctx, `INSERT INTO thread_label (thread_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
				r.ThreadID, labelID); err != nil {
				return fmt.Errorf("label thread: %w", err)
			}
		}
		if err := mail.TouchContact(ctx, tx, p.From); err != nil {
			return err
		}
		return mail.Recompute(ctx, tx, r.ThreadID)
	})
	if dup && err == nil && r.MessageID == "" {
		// Lost the race inside the transaction: report the stored copy.
		err = s.DB.QueryRow(ctx, `SELECT id, thread_id FROM message WHERE mailbox_id = $1 AND rfc_message_id = $2`,
			box.ID, *p.MessageID).Scan(&r.MessageID, &r.ThreadID)
	}
	return r, dup, err
}

// receivedAt trusts the Date header unless it is missing, unreadable or in
// the future (which would pin a message to the top of the list).
func (s *Service) receivedAt(date *string) time.Time {
	now := s.Now()
	if date == nil {
		return now
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC1123Z, time.RFC1123} {
		if t, err := time.Parse(layout, *date); err == nil {
			if t.After(now) {
				return now
			}
			return t
		}
	}
	return now
}

// findThread threads on In-Reply-To/References first, then on subject
// within 30 days. SES replaces our Message-ID with its own
// (<id@email.amazonses.com>), so a reference also matches ses_message_id.
//
// Both signals are written by the sender, so neither alone may put a
// message into a conversation: anyone can copy a subject, and a Message-ID
// leaks with every forward. A reference match also needs the sender to be
// on the thread already or the subject to match; a subject match needs the
// sender to be on the thread.
func findThread(ctx context.Context, tx pgx.Tx, mailboxID string, p *Payload, subject string) (string, error) {
	var refs, sesIDs []string
	if p.InReplyTo != nil && *p.InReplyTo != "" {
		refs = append(refs, *p.InReplyTo)
	}
	refs = append(refs, p.References...)
	for _, ref := range refs {
		bare := strings.Trim(ref, "<>")
		if local, ok := strings.CutSuffix(bare, "@email.amazonses.com"); ok {
			sesIDs = append(sesIDs, local)
		}
	}
	type cand struct {
		ID          string
		Subject     string
		Participant bool
	}
	isParticipant := `t.participants @> jsonb_build_array(jsonb_build_object('address', $2::text))`
	if len(refs) > 0 {
		rows, _ := tx.Query(ctx, `SELECT DISTINCT ON (t.id) t.id, t.subject, `+isParticipant+`
			FROM message m JOIN thread t ON t.id = m.thread_id
			WHERE m.mailbox_id = $1 AND (m.rfc_message_id = ANY($3) OR m.ses_message_id = ANY($4))
			ORDER BY t.id LIMIT 20`, mailboxID, p.From.Address, refs, nonNil(sesIDs))
		cands, err := pgx.CollectRows(rows, pgx.RowToStructByPos[cand])
		if err != nil {
			return "", fmt.Errorf("thread by reference: %w", err)
		}
		for _, c := range cands {
			if c.Participant || (subject != "" && strings.EqualFold(addr.NormalizeSubject(c.Subject), subject)) {
				return c.ID, nil
			}
		}
	}
	if subject == "" {
		return "", nil
	}
	// The thread's subject may carry "Re:" itself, so compare normalized.
	// ESCAPE '' keeps a backslash in the subject literal; % and _ in it only
	// widen the prefilter, the EqualFold below decides.
	rows, _ := tx.Query(ctx, `SELECT t.id, t.subject, true FROM thread t WHERE t.mailbox_id = $1 AND `+isParticipant+`
		AND t.last_message_at > now() - interval '30 days' AND lower(t.subject) LIKE '%' || lower($3) ESCAPE ''
		ORDER BY t.last_message_at DESC LIMIT 20`, mailboxID, p.From.Address, subject)
	cands, err := pgx.CollectRows(rows, pgx.RowToStructByPos[cand])
	if err != nil {
		return "", fmt.Errorf("thread by subject: %w", err)
	}
	for _, c := range cands {
		if strings.EqualFold(addr.NormalizeSubject(c.Subject), subject) {
			return c.ID, nil
		}
	}
	return "", nil
}

type actions struct {
	moved    bool
	folder   string
	markRead bool
	star     bool
	labels   []string
}

// applyFilters runs enabled filter rules, highest priority first. A rule
// matches when every condition it sets is a case-insensitive substring.
func applyFilters(ctx context.Context, tx pgx.Tx, p *Payload, folder string) (actions, error) {
	act := actions{folder: folder}
	rows, _ := tx.Query(ctx, `SELECT match_from, match_to, match_subject, match_body, action_folder::text,
		action_label_id, action_mark_read, action_star FROM filter_rule WHERE enabled ORDER BY priority DESC, created_at`)
	type rule struct {
		From, To, Subject, Body *string
		Folder, Label           *string
		MarkRead, Star          bool
	}
	rules, err := pgx.CollectRows(rows, pgx.RowToStructByPos[rule])
	if err != nil {
		return act, fmt.Errorf("load filters: %w", err)
	}
	hay := [4]string{
		p.From.Address,
		strings.ToLower(strings.Join(addr.Addresses(p.ToAddresses), ",")),
		strings.ToLower(p.Subject),
		strings.ToLower(deref(p.Text)),
	}
	for _, r := range rules {
		needles := [4]*string{r.From, r.To, r.Subject, r.Body}
		active, ok := 0, true
		for i, n := range needles {
			if n == nil || *n == "" {
				continue
			}
			active++
			if !strings.Contains(hay[i], strings.ToLower(*n)) {
				ok = false
			}
		}
		if active == 0 || !ok {
			continue
		}
		// Highest priority first, so the first matching rule picks the
		// folder; flags and labels add up.
		if r.Folder != nil && !act.moved {
			act.folder, act.moved = *r.Folder, true
		}
		act.markRead = act.markRead || r.MarkRead
		act.star = act.star || r.Star
		if r.Label != nil {
			act.labels = append(act.labels, *r.Label)
		}
	}
	return act, nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func nonNilAddrs(a []addr.Address) []addr.Address {
	if a == nil {
		return []addr.Address{}
	}
	return a
}

func dedupe(list []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, a := range list {
		a = strings.ToLower(strings.TrimSpace(a))
		if a != "" && !seen[a] {
			seen[a] = true
			out = append(out, a)
		}
	}
	return out
}
