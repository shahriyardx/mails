package mail

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/page"
)

// ThreadFilter narrows a thread list. Zero values mean "any".
type ThreadFilter struct {
	Allowed        []string // nil = every mailbox
	MailboxID      string   // id or address
	Domain         string
	Folder         string // a folder, "starred", "snoozed", "all" or ""
	Label          string // id or name
	Query          string // search box text: filters and free text (ParseSearch)
	Unread         *bool
	Starred        *bool
	HasAttachments *bool
	Participant    string
	Subject        string
	Since, Until   *time.Time
	Page           page.Params
}

var folders = map[string]bool{"inbox": true, "sent": true, "drafts": true, "archive": true, "spam": true, "trash": true}

// ListThreads returns one page, newest first, with labels (one extra query
// for the whole page).
func (s *Service) ListThreads(ctx context.Context, f ThreadFilter) (page.List[*Thread], error) {
	var w where
	w.scope("t.mailbox_id", f.Allowed, f.MailboxID, f.Domain)
	search := ParseSearch(f.Query)
	if v := search.view(); v != "" {
		f.Folder = v // in: in the search box picks the list
	}
	switch {
	case f.Folder == "" || f.Folder == "all":
	case f.Folder == "starred":
		w.add("t.is_starred AND t.folders <> '{trash}'")
	case f.Folder == "snoozed":
		w.add("t.snoozed_until IS NOT NULL")
	case folders[f.Folder]:
		w.add("t.folders @> ARRAY[?]::folder[]", f.Folder)
		if f.Folder == "inbox" {
			w.add("t.snoozed_until IS NULL") // back when the snooze ends
		}
	default:
		return page.List[*Thread]{}, httpx.Invalid("folder", "folder: One of inbox, sent, drafts, archive, spam, trash, starred, snoozed, all")
	}
	if f.Label != "" {
		w.add(labelCond("t.id"), f.Label, f.Label)
	}
	search.threadConds(&w)
	if f.Unread != nil {
		w.add("(t.unread_count > 0) = ?", *f.Unread)
	}
	if f.Starred != nil {
		w.add("t.is_starred = ?", *f.Starred)
	}
	if f.HasAttachments != nil {
		w.add("t.has_attachments = ?", *f.HasAttachments)
	}
	if f.Participant != "" {
		w.add("t.participants @> jsonb_build_array(jsonb_build_object('address', lower(?::text)))", f.Participant)
	}
	if f.Subject != "" {
		w.add("t.subject ILIKE ?", "%"+likeEscape(f.Subject)+"%")
	}
	if f.Since != nil {
		w.add("t.last_message_at >= ?", *f.Since)
	}
	if f.Until != nil {
		w.add("t.last_message_at < ?", *f.Until)
	}
	if c := f.Page.Cursor; c != nil {
		w.add("(t.last_message_at, t.id) < (?, ?)", c.Time(), c.ID)
	}
	limit := w.arg(f.Page.Limit + 1)
	rows, _ := s.DB.Query(ctx, `SELECT `+threadColumns+` FROM thread t JOIN mailbox mb ON mb.id = t.mailbox_id `+
		w.sql()+` ORDER BY t.last_message_at DESC, t.id DESC LIMIT `+limit, w.args...)
	list, err := pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[Thread])
	if err != nil {
		return page.List[*Thread]{}, fmt.Errorf("list threads: %w", err)
	}
	out := page.Build(list, f.Page.Limit, func(t *Thread) (int64, string) { return t.LastMessageAt.UnixMicro(), t.ID })
	if err := s.attachLabels(ctx, out.Data); err != nil {
		return out, err
	}
	return out, nil
}

func (s *Service) attachLabels(ctx context.Context, threads []*Thread) error {
	byID := make(map[string]*Thread, len(threads))
	ids := make([]string, len(threads))
	for i, t := range threads {
		t.Object, t.Labels = "thread", []Label{}
		byID[t.ID], ids[i] = t, t.ID
	}
	if len(ids) == 0 {
		return nil
	}
	rows, _ := s.DB.Query(ctx, `SELECT tl.thread_id, l.id, l.name, l.color, l.created_at FROM thread_label tl
		JOIN label l ON l.id = tl.label_id WHERE tl.thread_id = ANY($1) ORDER BY l.name`, ids)
	var threadID string
	var l Label
	_, err := pgx.ForEachRow(rows, []any{&threadID, &l.ID, &l.Name, &l.Color, &l.CreatedAt}, func() error {
		l.Object = "label"
		byID[threadID].Labels = append(byID[threadID].Labels, l)
		return nil
	})
	if err != nil {
		return fmt.Errorf("thread labels: %w", err)
	}
	return nil
}

// GetThread returns a thread with every message (bodies when withBody),
// their attachments, and its labels.
func (s *Service) GetThread(ctx context.Context, allowed []string, id string, withBody bool) (*Thread, error) {
	var w where
	w.add("t.id = ?", id)
	w.scope("t.mailbox_id", allowed, "", "")
	rows, _ := s.DB.Query(ctx, `SELECT `+threadColumns+` FROM thread t JOIN mailbox mb ON mb.id = t.mailbox_id `+w.sql(), w.args...)
	t, err := pgx.CollectExactlyOneRow(rows, pgx.RowToAddrOfStructByName[Thread])
	if err == pgx.ErrNoRows {
		return nil, httpx.NotFound("No such thread")
	}
	if err != nil {
		return nil, fmt.Errorf("get thread: %w", err)
	}
	if err := s.attachLabels(ctx, []*Thread{t}); err != nil {
		return nil, err
	}
	rows, _ = s.DB.Query(ctx, `SELECT `+messageColumns(withBody)+` FROM message m JOIN mailbox mb ON mb.id = m.mailbox_id
		WHERE m.thread_id = $1 ORDER BY m.received_at, m.id`, id)
	t.Messages, err = pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[Message])
	if err != nil {
		return nil, fmt.Errorf("thread messages: %w", err)
	}
	return t, s.attachFiles(ctx, t.Messages, false)
}

// attachFiles loads attachments (and events, when withEvents) for messages
// in one query each.
func (s *Service) attachFiles(ctx context.Context, msgs []*Message, withEvents bool) error {
	byID := make(map[string]*Message, len(msgs))
	ids := make([]string, len(msgs))
	for i, m := range msgs {
		m.finish()
		m.Attachments = []*Attachment{}
		byID[m.ID], ids[i] = m, m.ID
	}
	if len(ids) == 0 {
		return nil
	}
	rows, _ := s.DB.Query(ctx, `SELECT `+attachmentColumns+` FROM attachment a WHERE a.message_id = ANY($1) ORDER BY a.created_at, a.id`, ids)
	files, err := pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[Attachment])
	if err != nil {
		return fmt.Errorf("message attachments: %w", err)
	}
	for _, a := range files {
		a.Object = "attachment"
		m := byID[*a.MessageID]
		m.Attachments = append(m.Attachments, a)
	}
	if !withEvents {
		return nil
	}
	rows, _ = s.DB.Query(ctx, `SELECT id, message_id, type::text AS type, recipient, detail, occurred_at FROM message_event
		WHERE message_id = ANY($1) ORDER BY occurred_at, id`, ids)
	events, err := pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[Event])
	if err != nil {
		return fmt.Errorf("message events: %w", err)
	}
	for _, m := range msgs {
		m.Events = []*Event{}
	}
	for _, e := range events {
		e.Object = "event"
		m := byID[*e.MessageID]
		m.Events = append(m.Events, e)
	}
	return nil
}

// Counts are the sidebar numbers: unread threads per folder (all threads
// for drafts, starred threads for starred) and unread inbox threads per
// mailbox.
type Counts struct {
	Folders   map[string]int `json:"folders"`
	Mailboxes map[string]int `json:"mailboxes"`
}

func (s *Service) Counts(ctx context.Context, allowed []string, mailbox, domain string) (*Counts, error) {
	c := &Counts{Folders: map[string]int{"inbox": 0, "starred": 0, "drafts": 0, "archive": 0, "spam": 0, "trash": 0}, Mailboxes: map[string]int{}}
	scoped := func() *where {
		w := &where{}
		w.scope("t.mailbox_id", allowed, mailbox, domain)
		return w
	}
	w := scoped()
	// A snoozed thread is out of the Inbox, so out of its count.
	rows, _ := s.DB.Query(ctx, `SELECT f::text, count(*) FILTER (WHERE (t.unread_count > 0 OR f = 'drafts')
			AND NOT (f = 'inbox' AND t.snoozed_until IS NOT NULL))
		FROM thread t, unnest(t.folders) f `+w.sql()+` GROUP BY f`, w.args...)
	var name string
	var n int
	if _, err := pgx.ForEachRow(rows, []any{&name, &n}, func() error {
		if name != "sent" {
			c.Folders[name] = n
		}
		return nil
	}); err != nil {
		return nil, fmt.Errorf("folder counts: %w", err)
	}
	st := scoped()
	st.add("t.is_starred AND t.folders <> '{trash}'")
	if err := s.DB.QueryRow(ctx, `SELECT count(*) FROM thread t `+st.sql(), st.args...).Scan(&n); err != nil {
		return nil, fmt.Errorf("starred count: %w", err)
	}
	c.Folders["starred"] = n
	var all where
	all.scope("mailbox_id", allowed, "", "")
	all.add("folders @> '{inbox}' AND unread_count > 0 AND snoozed_until IS NULL")
	rows, _ = s.DB.Query(ctx, `SELECT mailbox_id, count(*) FROM thread `+all.sql()+` GROUP BY mailbox_id`, all.args...)
	if _, err := pgx.ForEachRow(rows, []any{&name, &n}, func() error {
		c.Mailboxes[name] = n
		return nil
	}); err != nil {
		return nil, fmt.Errorf("mailbox counts: %w", err)
	}
	return c, nil
}

func likeEscape(s string) string {
	r := []rune{}
	for _, c := range s {
		if c == '%' || c == '_' || c == '\\' {
			r = append(r, '\\')
		}
		r = append(r, c)
	}
	return string(r)
}
