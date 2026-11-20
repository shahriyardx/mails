// Package send composes and sends mail through SES: one sync attempt, then
// the send_job queue for anything SES could not take right now. It also
// keeps drafts and builds replies.
package send

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/events"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/id"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/mailbox"
	"github.com/shahriyardx/mails/internal/realtime"
	"github.com/shahriyardx/mails/internal/ses"
	"github.com/shahriyardx/mails/internal/storage"
)

const (
	maxRecipients = 50       // SES's limit per message
	maxFiles      = 20       // per message, as the API documents
	maxRaw        = 40 << 20 // SES's limit on a whole message
	sesTimeout    = 20 * time.Second
)

// Service sends mail. Every field except Events is required.
type Service struct {
	DB        *pgxpool.Pool
	SES       ses.Client
	Store     storage.Store
	Mailboxes *mailbox.Service
	Mail      *mail.Service
	Hub       *realtime.Hub
	Events    events.Sink
	// ConfigSet returns the SES configuration set to send with ("" for
	// none). It is read per send, so setting up reporting needs no restart.
	ConfigSet func() string
	// Region is the SES region; it names the host of the Message-ID SES
	// puts on the mail it sends.
	Region string
	Now    func() time.Time

	once sync.Once
	wake chan struct{}
}

// Recipients is a list given as one string ("a@x, B <b@y>") or an array.
type Recipients []addr.Address

func (r *Recipients) UnmarshalJSON(b []byte) error {
	var one string
	if json.Unmarshal(b, &one) == nil {
		*r = addr.ParseList(one)
		return nil
	}
	var many []string
	if err := json.Unmarshal(b, &many); err != nil {
		return errors.New("must be a string or an array of strings")
	}
	*r = nil
	for _, s := range many {
		*r = append(*r, addr.ParseList(s)...)
	}
	return nil
}

// Upload is a file given inline in an API request.
type Upload struct {
	Filename    string `json:"filename" validate:"required,max=255"`
	Content     string `json:"content" validate:"required"` // base64, data: prefix allowed
	ContentType string `json:"content_type"`
	ContentID   string `json:"content_id"`
}

// Input is one message to send (or save as a draft).
type Input struct {
	From          string            `json:"from" validate:"required"`
	To            Recipients        `json:"to"`
	Cc            Recipients        `json:"cc"`
	Bcc           Recipients        `json:"bcc"`
	ReplyTo       string            `json:"reply_to"`
	Subject       string            `json:"subject" validate:"max=998"`
	HTML          string            `json:"html"`
	Text          string            `json:"text"`
	Headers       map[string]string `json:"headers"`
	Attachments   []Upload          `json:"attachments" validate:"max=20,dive"`
	AttachmentIDs []string          `json:"attachment_ids" validate:"max=20"` // staged uploads, or files of a message being forwarded
	ThreadID      string            `json:"thread_id"`
	InReplyTo     string            `json:"in_reply_to"`
	References    []string          `json:"references"`
	DraftID       string            `json:"draft_id"`

	APIKeyID string   `json:"-"`
	Allowed  []string `json:"-"` // mailboxes the caller reaches; nil = all
}

// Result is what a send returns, in the public API shape.
type Result struct {
	ID           string   `json:"id"`
	MessageID    string   `json:"message_id"`
	SESMessageID *string  `json:"ses_message_id"`
	ThreadID     string   `json:"thread_id"`
	From         string   `json:"from"`
	To           []string `json:"to"`
	Subject      string   `json:"subject"`
	Status       string   `json:"status"`
	Error        *string  `json:"error,omitempty"`
}

// prepared is a validated message, ready to go out or be saved.
type prepared struct {
	in          *Input
	box         *mailbox.Mailbox
	from        addr.Address
	files       []File
	staged      []string     // attachment ids to move onto the message
	copies      []storedCopy // files to store as new attachments
	thread      string       // existing thread, if any
	draftThread string       // the draft's thread before sending, if any
	rfcID       string       // without <>
	text        string
	html        string
	raw         []byte
	envelop     []string
}

type storedCopy struct {
	file File
	id   string
	key  string
}

// Send validates, builds and sends one message. A refusal SES will repeat
// (bad address, unverified identity) is an error and nothing is recorded;
// anything else is queued and retried.
func (s *Service) Send(ctx context.Context, in Input) (*Result, error) {
	p, err := s.prepare(ctx, &in, false)
	if err != nil {
		return nil, err
	}
	// Everything that can fail goes before SES, so a message SES accepted
	// is always recorded: file copies are stored and a draft is claimed (two
	// sends of one draft cannot both go out).
	if err := s.storeCopies(ctx, p.copies); err != nil {
		return nil, err
	}
	if err := s.claimDraft(ctx, p.in.DraftID, true); err != nil {
		s.dropCopies(p.copies)
		return nil, err
	}
	status, sesID, reason := "sent", "", ""
	sendCtx, cancel := context.WithTimeout(ctx, sesTimeout)
	sesID, err = s.SES.SendRaw(sendCtx, ses.RawEmail{From: p.box.Address, To: p.envelop, Raw: p.raw, ConfigurationSet: s.configSet()})
	cancel()
	if err != nil {
		if ses.Permanent(err) {
			s.dropCopies(p.copies)
			_ = s.claimDraft(context.WithoutCancel(ctx), p.in.DraftID, false)
			return nil, &httpx.Error{Status: 422, Code: "invalid_request", Message: "SES refused this message: " + err.Error()}
		}
		status, reason = "queued", err.Error()
		slog.Warn("send queued after SES error", "err", err)
	}
	// SES has decided; the caller going away must not stop the record.
	recCtx, cancelRec := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancelRec()
	res, err := s.record(recCtx, p, status, sesID, reason)
	if err != nil {
		// SES has it but the row did not commit. Say so loudly: the mail is
		// out and a retry by the caller would send it twice.
		if status == "sent" {
			slog.Error("message sent but not recorded", "ses_message_id", sesID, "err", err)
		}
		return nil, err
	}
	if status == "queued" {
		s.Wake()
	} else {
		s.emitEmail(recCtx, "email.sent", res.ID)
	}
	return res, nil
}

// wireID is the Message-ID recipients see: SES replaces the one we wrote
// with its own, so replies point at this one.
func (s *Service) wireID(sesID string) string {
	return "<" + sesID + "@" + ses.MessageIDHost(s.Region) + ">"
}

func (s *Service) configSet() string {
	if s.ConfigSet == nil {
		return ""
	}
	return s.ConfigSet()
}

func (s *Service) storeCopies(ctx context.Context, copies []storedCopy) error {
	for i, c := range copies {
		if err := s.Store.Put(ctx, c.key, bytes.NewReader(c.file.Data), nonEmpty(c.file.ContentType, "application/octet-stream")); err != nil {
			s.dropCopies(copies[:i])
			return err
		}
	}
	return nil
}

// claimDraft takes a draft out of circulation before it is sent (on) or
// puts it back when SES refused it (off). A draft already claimed is a 409.
func (s *Service) claimDraft(ctx context.Context, draftID string, on bool) error {
	if draftID == "" {
		return nil
	}
	// While claimed, the row is folder 'drafts' with is_draft false: no
	// longer a draft anyone can send, not yet sent.
	tag, err := s.DB.Exec(ctx, `UPDATE message SET is_draft = NOT $2 WHERE id = $1 AND is_draft = $2 AND folder = 'drafts'`, draftID, on)
	if err != nil {
		return fmt.Errorf("claim draft: %w", err)
	}
	if tag.RowsAffected() == 0 && on {
		return httpx.Conflict("This draft is already being sent")
	}
	return nil
}

// prepare checks everything and builds the MIME bytes, before any write.
func (s *Service) prepare(ctx context.Context, in *Input, draft bool) (*prepared, error) {
	if err := httpx.Validate(in); err != nil {
		return nil, err
	}
	from, ok := addr.Parse(in.From)
	if !ok {
		return nil, httpx.Invalid("from", "from: Not an email address")
	}
	box, err := s.Mailboxes.ForSending(ctx, from.Address)
	if errors.Is(err, mailbox.ErrNotCovered) && draft {
		// A draft is not mail yet: an existing mailbox may keep one even
		// while its domain cannot send (receive-only, or verification
		// lapsed). Sending it still needs the domain.
		box, err = s.Mailboxes.Get(ctx, from.Address)
		if err != nil {
			err = mailbox.ErrNotCovered
		}
	}
	if errors.Is(err, mailbox.ErrNotCovered) {
		return nil, httpx.Invalid("from", "from: "+from.Address+" is not on a domain verified for sending")
	} else if err != nil {
		return nil, err
	}
	if in.APIKeyID != "" && in.DraftID != "" {
		return nil, httpx.Invalid("draft_id", "draft_id: Drafts belong to the dashboard")
	}
	if in.Allowed != nil && !contains(in.Allowed, box.ID) {
		return nil, httpx.Forbidden("This API key cannot send as " + box.Address)
	}
	if from.Name == "" {
		from.Name = box.DisplayName
	}
	if !draft {
		if len(in.To) == 0 {
			return nil, httpx.Invalid("to", "to: Required")
		}
	}
	all := append(append(append([]addr.Address{}, in.To...), in.Cc...), in.Bcc...)
	if len(all) > maxRecipients {
		return nil, httpx.Invalid("to", fmt.Sprintf("to: At most %d recipients across to, cc and bcc", maxRecipients))
	}
	if in.ReplyTo != "" {
		if _, ok := addr.Parse(in.ReplyTo); !ok {
			return nil, httpx.Invalid("reply_to", "reply_to: Not an email address")
		}
	}
	if err := CheckHeaders(in.Headers); err != nil {
		return nil, err
	}
	p := &prepared{in: in, box: box, from: from, envelop: addr.Addresses(all)}
	if !draft {
		if err := s.checkSuppressed(ctx, p.envelop); err != nil {
			return nil, err
		}
	}
	if in.DraftID != "" {
		var draftMailbox string
		var isDraft bool
		var folder string
		err := s.DB.QueryRow(ctx, `SELECT thread_id, mailbox_id, is_draft, folder::text FROM message WHERE id = $1 AND is_outbound`, in.DraftID).
			Scan(&p.draftThread, &draftMailbox, &isDraft, &folder)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && in.Allowed != nil && !contains(in.Allowed, draftMailbox)) {
			return nil, httpx.NotFound("No such draft")
		}
		if err != nil {
			return nil, fmt.Errorf("load draft: %w", err)
		}
		if folder != "drafts" {
			return nil, httpx.Conflict("This draft was already sent")
		}
		if !isDraft && !draft {
			return nil, httpx.Conflict("This draft is already being sent")
		}
	}
	threadID := in.ThreadID
	if threadID == "" {
		threadID = p.draftThread
	}
	if p.thread, err = s.ownThread(ctx, threadID, box.ID); err != nil {
		return nil, err
	}
	if err := s.loadFiles(ctx, p, draft); err != nil {
		return nil, err
	}
	p.html, p.text = in.HTML, in.Text
	if strings.TrimSpace(p.html) == "" && p.text != "" {
		p.html = addr.TextToHTML(p.text)
	}
	if strings.TrimSpace(p.text) == "" && p.html != "" {
		p.text = addr.HTMLToText(p.html)
	}
	p.rfcID = id.Token(16) + "@" + box.Domain
	if draft {
		return p, nil
	}
	p.raw, err = Build(Mail{
		From: from, To: in.To, Cc: in.Cc, ReplyTo: in.ReplyTo, Subject: in.Subject,
		Text: p.text, HTML: p.html, MessageID: p.rfcID, InReplyTo: in.InReplyTo,
		References: in.References, Headers: in.Headers, Files: p.files, Date: s.Now(),
	})
	if err != nil {
		return nil, err
	}
	if len(p.raw) > maxRaw {
		return nil, &httpx.Error{Status: 413, Code: "payload_too_large", Message: "The message is over SES's 40 MB limit"}
	}
	return p, nil
}

func (s *Service) checkSuppressed(ctx context.Context, recipients []string) error {
	rows, _ := s.DB.Query(ctx, `SELECT address FROM suppression WHERE address = ANY($1) ORDER BY address`, recipients)
	blocked, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("check suppressions: %w", err)
	}
	if len(blocked) > 0 {
		return &httpx.Error{Status: 409, Code: "conflict", Message: "Blocked after an earlier bounce or complaint: " + strings.Join(blocked, ", "),
			Extra: map[string]any{"suppressed": blocked}}
	}
	return nil
}

// ownThread returns threadID when it belongs to the sending mailbox, else
// "" (a new thread). Replying across mailboxes would split a conversation.
func (s *Service) ownThread(ctx context.Context, threadID, mailboxID string) (string, error) {
	if threadID == "" {
		return "", nil
	}
	var ok bool
	if err := s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM thread WHERE id = $1 AND mailbox_id = $2)`, threadID, mailboxID).Scan(&ok); err != nil {
		return "", fmt.Errorf("check thread: %w", err)
	}
	if !ok {
		return "", nil
	}
	return threadID, nil
}

// loadFiles reads every file the message carries: inline API uploads,
// staged uploads, files already on the draft, and files of a message the
// caller reaches (forwarding).
func (s *Service) loadFiles(ctx context.Context, p *prepared, draft bool) error {
	in := p.in
	for i, u := range in.Attachments {
		content := u.Content
		if j := strings.Index(content, ";base64,"); strings.HasPrefix(content, "data:") && j >= 0 {
			content = content[j+len(";base64,"):]
		}
		data, err := base64.StdEncoding.DecodeString(content)
		if err != nil {
			return httpx.Invalid("attachments", fmt.Sprintf("attachments[%d].content: Not base64", i))
		}
		f := File{Name: u.Filename, ContentType: u.ContentType, ContentID: u.ContentID, Data: data}
		p.files = append(p.files, f)
		attID := id.New("att")
		p.copies = append(p.copies, storedCopy{file: f, id: attID, key: "sent/" + attID})
	}
	type row struct {
		ID, Filename, ContentType, R2Key string
		ContentID                        *string
		MessageID                        *string
		MailboxID                        *string
	}
	// attachment_ids is the whole list: a file of the draft that is not
	// named was removed by the composer and is dropped on save or send.
	ids := in.AttachmentIDs
	if len(ids) == 0 {
		return nil
	}
	rows, _ := s.DB.Query(ctx, `SELECT a.id, a.filename, a.content_type, a.r2_key, a.content_id, a.message_id, m.mailbox_id
		FROM attachment a LEFT JOIN message m ON m.id = a.message_id WHERE a.id = ANY($1)`, dedupe(ids))
	found, err := pgx.CollectRows(rows, pgx.RowToStructByPos[row])
	if err != nil {
		return fmt.Errorf("load files: %w", err)
	}
	if len(found) != len(dedupe(ids)) {
		return httpx.Invalid("attachment_ids", "attachment_ids: One or more files do not exist")
	}
	for _, a := range found {
		switch {
		case a.MessageID == nil && in.APIKeyID != "":
			// Staged uploads belong to the dashboard's composer.
			return httpx.Invalid("attachment_ids", "attachment_ids: One or more files do not exist")
		case a.MessageID == nil, in.DraftID != "" && *a.MessageID == in.DraftID:
			p.staged = append(p.staged, a.ID) // moves onto the new message
		case in.Allowed == nil || contains(in.Allowed, deref(a.MailboxID)):
			// A file of another message: forwarded, so it gets its own copy
			// (deleting either message must not break the other).
		default:
			return httpx.Invalid("attachment_ids", "attachment_ids: One or more files do not exist")
		}
		if draft {
			// A draft only records which files it holds; bytes are read when
			// it is sent. A forwarded file is copied then too.
			continue
		}
		obj, err := s.Store.Get(ctx, a.R2Key)
		if err != nil {
			return fmt.Errorf("read %s: %w", a.Filename, err)
		}
		data, err := io.ReadAll(io.LimitReader(obj.Body, maxRaw+1))
		obj.Body.Close()
		if err != nil {
			return fmt.Errorf("read %s: %w", a.Filename, err)
		}
		f := File{Name: a.Filename, ContentType: a.ContentType, ContentID: deref(a.ContentID), Data: data}
		p.files = append(p.files, f)
		if a.MessageID != nil && (in.DraftID == "" || *a.MessageID != in.DraftID) {
			attID := id.New("att")
			p.copies = append(p.copies, storedCopy{file: f, id: attID, key: "sent/" + attID})
		}
	}
	if len(p.files) > maxFiles {
		return httpx.Invalid("attachments", fmt.Sprintf("attachments: At most %d files", maxFiles))
	}
	return nil
}

// record writes the sent (or queued) message, its thread, files and job.
func (s *Service) record(ctx context.Context, p *prepared, status, sesID, reason string) (*Result, error) {
	now := s.Now()
	msgID := p.in.DraftID
	if msgID == "" {
		msgID = id.New("msg")
	}
	threadID := p.thread
	var sesPtr, reasonPtr *string
	rfcID := "<" + p.rfcID + ">"
	if sesID != "" {
		sesPtr = &sesID
		rfcID = s.wireID(sesID)
	}
	if reason != "" {
		reasonPtr = &reason
	}
	var sentAt *time.Time
	if status == "sent" {
		sentAt = &now
	}
	var dropped []string
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if threadID == "" {
			threadID = id.New("thr")
			if _, err := tx.Exec(ctx, `INSERT INTO thread (id, mailbox_id, subject, last_message_at) VALUES ($1, $2, $3, $4)`,
				threadID, p.box.ID, p.in.Subject, now); err != nil {
				return fmt.Errorf("insert thread: %w", err)
			}
		}
		args := []any{msgID, threadID, p.box.ID, rfcID, nilIfEmpty(p.in.InReplyTo), nonNil(p.in.References),
			p.from.Name, p.box.Address, addrs(p.in.To), addrs(p.in.Cc), addrs(p.in.Bcc), nilIfEmpty(p.in.ReplyTo), p.in.Subject,
			addr.Snippet(p.text, p.html), nilIfEmpty(p.text), nilIfEmpty(p.html), sesPtr, status, reasonPtr,
			nilIfEmpty(p.in.APIKeyID), len(p.raw), sentAt, now}
		if p.in.DraftID != "" {
			tag, err := tx.Exec(ctx, `UPDATE message SET thread_id = $2, mailbox_id = $3, rfc_message_id = $4, in_reply_to = $5,
				"references" = $6, from_name = $7, from_address = $8, to_addrs = $9, cc_addrs = $10, bcc_addrs = $11, reply_to = $12,
				subject = $13, snippet = $14, text_body = $15, html_body = $16, ses_message_id = $17, delivery_status = $18,
				delivery_error = $19, api_key_id = $20, size_bytes = $21, sent_at = $22, received_at = $23,
				folder = 'sent', is_draft = false, is_outbound = true, is_read = true
				WHERE id = $1 AND folder = 'drafts' AND NOT is_draft`, args...)
			if err != nil {
				return fmt.Errorf("send draft: %w", err)
			}
			if tag.RowsAffected() == 0 {
				return httpx.NotFound("No such draft")
			}
		} else if _, err := tx.Exec(ctx, `INSERT INTO message (id, thread_id, mailbox_id, rfc_message_id, in_reply_to, "references",
				from_name, from_address, to_addrs, cc_addrs, bcc_addrs, reply_to, subject, snippet, text_body, html_body,
				ses_message_id, delivery_status, delivery_error, api_key_id, size_bytes, sent_at, received_at,
				folder, is_outbound, is_read)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, 'sent', true, true)`,
			args...); err != nil {
			return fmt.Errorf("insert message: %w", err)
		}
		if err := attachFiles(ctx, tx, msgID, p.in.DraftID != "", p.staged, &dropped); err != nil {
			return err
		}
		for _, c := range p.copies {
			if _, err := tx.Exec(ctx, `INSERT INTO attachment (id, message_id, filename, content_type, size_bytes, r2_key, content_id, is_inline)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, c.id, msgID, c.file.Name, nonEmpty(c.file.ContentType, "application/octet-stream"),
				len(c.file.Data), c.key, nilIfEmpty(c.file.ContentID), c.file.ContentID != ""); err != nil {
				return fmt.Errorf("insert file: %w", err)
			}
		}
		if status == "queued" {
			if _, err := tx.Exec(ctx, `INSERT INTO send_job (id, message_id, mailbox_id, from_address, recipients, raw_mime, attempts, next_attempt_at, last_error)
				VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8)`, id.New("job"), msgID, p.box.ID, p.box.Address, p.envelop, p.raw,
				now.Add(Backoff(1)), reasonPtr); err != nil {
				return fmt.Errorf("enqueue: %w", err)
			}
		}
		for _, a := range append(append([]addr.Address{}, p.in.To...), p.in.Cc...) {
			if err := mail.TouchContact(ctx, tx, a); err != nil {
				return err
			}
		}
		if p.draftThread != "" && p.draftThread != threadID {
			if err := mail.Recompute(ctx, tx, p.draftThread); err != nil {
				return err
			}
		}
		return mail.Recompute(ctx, tx, threadID)
	})
	if err != nil {
		s.dropCopies(p.copies)
		return nil, err
	}
	s.forgetFiles(dropped)
	s.Hub.Publish(realtime.Event{Type: "thread.updated", Data: map[string]any{"thread_ids": []string{threadID}}})
	return &Result{
		ID: msgID, MessageID: rfcID, SESMessageID: sesPtr, ThreadID: threadID, From: p.box.Address,
		To: addr.Addresses(p.in.To), Subject: p.in.Subject, Status: status, Error: reasonPtr,
	}, nil
}

// attachFiles moves staged files onto msgID. For a draft, files it held
// that are no longer listed are deleted; their stored keys are appended to
// dropped for removal after commit.
func attachFiles(ctx context.Context, tx pgx.Tx, msgID string, isDraft bool, keep []string, dropped *[]string) error {
	if len(keep) > 0 {
		if _, err := tx.Exec(ctx, `UPDATE attachment SET message_id = $1 WHERE id = ANY($2)`, msgID, keep); err != nil {
			return fmt.Errorf("attach files: %w", err)
		}
	}
	if !isDraft {
		return nil
	}
	rows, _ := tx.Query(ctx, `DELETE FROM attachment WHERE message_id = $1 AND NOT (id = ANY($2)) RETURNING r2_key`, msgID, nonNil(keep))
	keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("drop removed files: %w", err)
	}
	*dropped = append(*dropped, keys...)
	return nil
}

// forgetFiles deletes stored files no row points at any more. Best effort:
// a failure leaves an orphan object, never a broken message.
func (s *Service) forgetFiles(keys []string) {
	if len(keys) == 0 {
		return
	}
	if err := s.Store.Delete(context.Background(), keys...); err != nil {
		slog.Warn("delete removed files", "err", err)
	}
}

func (s *Service) dropCopies(copies []storedCopy) {
	if len(copies) == 0 {
		return
	}
	keys := make([]string, len(copies))
	for i, c := range copies {
		keys[i] = c.key
	}
	if err := s.Store.Delete(context.Background(), keys...); err != nil {
		slog.Warn("clean up stored copies", "err", err)
	}
}

// emitEmail tells listeners about an outbound message, with the public
// message shape as the payload.
func (s *Service) emitEmail(ctx context.Context, event, messageID string) {
	if s.Events == nil {
		return
	}
	var mailboxID string
	if err := s.DB.QueryRow(ctx, `SELECT mailbox_id FROM message WHERE id = $1`, messageID).Scan(&mailboxID); err != nil {
		slog.Error("emit "+event, "message", messageID, "err", err)
		return
	}
	msg, err := s.Mail.GetMessage(ctx, nil, messageID)
	if err != nil {
		slog.Error("emit "+event, "message", messageID, "err", err)
		return
	}
	msg.Text, msg.HTML = nil, nil
	s.Events.Emit(ctx, events.Event{Type: event, MailboxID: mailboxID, Data: map[string]any{"email": msg}})
}

func addrs(a []addr.Address) []addr.Address {
	if a == nil {
		return []addr.Address{}
	}
	return a
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func dedupe(list []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, v := range list {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}
