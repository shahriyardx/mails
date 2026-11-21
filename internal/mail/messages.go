package mail

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/page"
	"github.com/shahriyardx/mails/internal/storage"
)

// MessageFilter narrows a message list. Zero values mean "any".
type MessageFilter struct {
	Allowed      []string
	MailboxID    string
	Domain       string
	Direction    string // inbound, outbound
	Folder       string // a folder, "all" or ""
	ThreadID     string
	Drafts       *bool
	Unread       *bool
	Starred      *bool
	From, To     string
	Subject      string
	Query        string // search box text: filters and free text (ParseSearch)
	Since, Until *time.Time
	Statuses     []string // delivery statuses, for sent mail
	Opened       *bool
	APIKeyID     string
	WithBody     bool
	Page         page.Params
}

// ListMessages returns one page, newest first.
func (s *Service) ListMessages(ctx context.Context, f MessageFilter) (page.List[*Message], error) {
	var w where
	w.scope("m.mailbox_id", f.Allowed, f.MailboxID, f.Domain)
	search := ParseSearch(f.Query)
	if v := search.view(); folders[v] || v == "all" {
		f.Folder = v // in: in the search box picks the folder; in:starred is a filter
	}
	switch f.Direction {
	case "":
	case "inbound", "outbound":
		w.add("m.is_outbound = ?", f.Direction == "outbound")
	default:
		return page.List[*Message]{}, httpx.Invalid("direction", "direction: One of inbound, outbound")
	}
	switch {
	case f.Folder == "" || f.Folder == "all":
	case folders[f.Folder]:
		w.add("m.folder = ?::folder", f.Folder)
	default:
		return page.List[*Message]{}, httpx.Invalid("folder", "folder: One of inbox, sent, drafts, archive, spam, trash, all")
	}
	if f.ThreadID != "" {
		w.add("m.thread_id = ?", f.ThreadID)
	}
	if f.Drafts != nil {
		w.add("m.is_draft = ?", *f.Drafts)
	}
	if f.Unread != nil {
		w.add("m.is_read = ?", !*f.Unread)
	}
	if f.Starred != nil {
		w.add("m.is_starred = ?", *f.Starred)
	}
	if f.From != "" {
		w.add("m.from_address = lower(?)", f.From)
	}
	if f.To != "" {
		w.add("(m.to_addrs || m.cc_addrs || m.bcc_addrs) @> jsonb_build_array(jsonb_build_object('address', lower(?::text)))", f.To)
	}
	if f.Subject != "" {
		w.add("m.subject ILIKE ?", "%"+likeEscape(f.Subject)+"%")
	}
	search.listConds(&w)
	if len(f.Statuses) > 0 {
		w.add("m.delivery_status::text = ANY(?)", f.Statuses)
	}
	if f.Opened != nil {
		w.add("(m.opened_at IS NOT NULL) = ?", *f.Opened)
	}
	if f.APIKeyID != "" {
		w.add("m.api_key_id = ?", f.APIKeyID)
	}
	if f.Since != nil {
		w.add("m.received_at >= ?", *f.Since)
	}
	if f.Until != nil {
		w.add("m.received_at < ?", *f.Until)
	}
	if c := f.Page.Cursor; c != nil {
		w.add("(m.received_at, m.id) < (?, ?)", c.Time(), c.ID)
	}
	limit := w.arg(f.Page.Limit + 1)
	rows, _ := s.DB.Query(ctx, `SELECT `+messageColumns(f.WithBody)+` FROM message m JOIN mailbox mb ON mb.id = m.mailbox_id `+
		w.sql()+` ORDER BY m.received_at DESC, m.id DESC LIMIT `+limit, w.args...)
	list, err := pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[Message])
	if err != nil {
		return page.List[*Message]{}, fmt.Errorf("list messages: %w", err)
	}
	out := page.Build(list, f.Page.Limit, func(m *Message) (int64, string) { return m.ReceivedAt.UnixMicro(), m.ID })
	for _, m := range out.Data {
		m.finish()
	}
	return out, nil
}

// GetMessage returns one message with its body, files and events.
func (s *Service) GetMessage(ctx context.Context, allowed []string, id string) (*Message, error) {
	var w where
	w.add("m.id = ?", id)
	w.scope("m.mailbox_id", allowed, "", "")
	rows, _ := s.DB.Query(ctx, `SELECT `+messageColumns(true)+` FROM message m JOIN mailbox mb ON mb.id = m.mailbox_id `+w.sql(), w.args...)
	m, err := pgx.CollectExactlyOneRow(rows, pgx.RowToAddrOfStructByName[Message])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.NotFound("No such message")
	}
	if err != nil {
		return nil, fmt.Errorf("get message: %w", err)
	}
	return m, s.attachFiles(ctx, []*Message{m}, true)
}

// MessageChange reads or stars one message.
type MessageChange struct {
	IsRead    *bool `json:"is_read"`
	IsStarred *bool `json:"is_starred"`
}

// ChangeMessage applies c to one message and recounts its thread.
func (s *Service) ChangeMessage(ctx context.Context, allowed []string, id string, c MessageChange) (*Message, error) {
	m, err := s.GetMessage(ctx, allowed, id)
	if err != nil {
		return nil, err
	}
	err = pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE message SET is_read = coalesce($2, is_read), is_starred = coalesce($3, is_starred) WHERE id = $1`,
			id, c.IsRead, c.IsStarred); err != nil {
			return fmt.Errorf("change message: %w", err)
		}
		return Recompute(ctx, tx, m.ThreadID)
	})
	if err != nil {
		return nil, err
	}
	s.threadsChanged([]string{m.ThreadID})
	return s.GetMessage(ctx, allowed, id)
}

// Raw streams the message exactly as it arrived. Only inbound mail has one.
func (s *Service) Raw(ctx context.Context, allowed []string, id string) (*storage.Object, error) {
	var w where
	w.add("id = ?", id)
	w.scope("mailbox_id", allowed, "", "")
	var key *string
	err := s.DB.QueryRow(ctx, `SELECT raw_key FROM message `+w.sql(), w.args...).Scan(&key)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && key == nil) {
		return nil, httpx.NotFound("No original stored for this message")
	}
	if err != nil {
		return nil, fmt.Errorf("raw key: %w", err)
	}
	obj, err := s.Store.Get(ctx, *key)
	if errors.Is(err, storage.ErrNotFound) {
		return nil, httpx.NotFound("No original stored for this message")
	}
	return obj, err
}
