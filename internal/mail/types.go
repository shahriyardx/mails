package mail

import (
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/realtime"
	"github.com/shahriyardx/mails/internal/storage"
)

// Service is the mail feature. Allowed mailbox lists passed to its methods
// narrow what a caller reaches; nil means every mailbox (the owner).
type Service struct {
	DB    *pgxpool.Pool
	Store storage.Store
	Hub   *realtime.Hub
	// OnThreadsUpdated runs after threads change state (folder, read, star,
	// labels). Hooks must not block.
	OnThreadsUpdated []func(threadIDs []string)
}

// Folders a thread or message can be moved to by a person or a key.
var movable = map[string]bool{"inbox": true, "archive": true, "spam": true, "trash": true}

// Label is a tag on threads.
type Label struct {
	Object    string    `json:"object" db:"-"`
	ID        string    `json:"id" db:"id"`
	Name      string    `json:"name" db:"name"`
	Color     string    `json:"color" db:"color"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// Thread is a conversation, shaped as the public API returns it.
type Thread struct {
	Object         string         `json:"object" db:"-"`
	ID             string         `json:"id" db:"id"`
	MailboxID      string         `json:"mailbox_id" db:"mailbox_id"`
	Mailbox        string         `json:"mailbox" db:"mailbox"`
	MailboxColor   string         `json:"mailbox_color" db:"mailbox_color"`
	Domain         string         `json:"domain" db:"domain"`
	Subject        string         `json:"subject" db:"subject"`
	Snippet        string         `json:"snippet" db:"snippet"`
	Folders        []string       `json:"folders" db:"folders"`
	Participants   []addr.Address `json:"participants" db:"participants"`
	MessageCount   int            `json:"message_count" db:"message_count"`
	UnreadCount    int            `json:"unread_count" db:"unread_count"`
	IsStarred      bool           `json:"is_starred" db:"is_starred"`
	HasAttachments bool           `json:"has_attachments" db:"has_attachments"`
	LastMessageAt  time.Time      `json:"last_message_at" db:"last_message_at"`
	CreatedAt      time.Time      `json:"created_at" db:"created_at"`
	Labels         []Label        `json:"labels" db:"-"`
	Messages       []*Message     `json:"messages,omitempty" db:"-"`
}

const threadColumns = `t.id, t.mailbox_id, mb.address AS mailbox, mb.color AS mailbox_color, mb.domain,
	t.subject, t.snippet, t.folders::text[] AS folders, t.participants, t.message_count, t.unread_count,
	t.is_starred, t.has_attachments, t.last_message_at, t.created_at`

// Attachment is a file on a message (or a staged upload with no message).
type Attachment struct {
	Object      string    `json:"object" db:"-"`
	ID          string    `json:"id" db:"id"`
	MessageID   *string   `json:"message_id" db:"message_id"`
	Filename    string    `json:"filename" db:"filename"`
	ContentType string    `json:"content_type" db:"content_type"`
	SizeBytes   int       `json:"size_bytes" db:"size_bytes"`
	ContentID   *string   `json:"content_id" db:"content_id"`
	IsInline    bool      `json:"is_inline" db:"is_inline"`
	R2Key       string    `json:"-" db:"r2_key"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

const attachmentColumns = `a.id, a.message_id, a.filename, a.content_type, a.size_bytes, a.content_id, a.is_inline, a.r2_key, a.created_at`

// Event is a delivery event on an outbound message.
type Event struct {
	Object     string    `json:"object" db:"-"`
	ID         string    `json:"id" db:"id"`
	MessageID  *string   `json:"-" db:"message_id"`
	Type       string    `json:"type" db:"type"`
	Recipient  *string   `json:"recipient" db:"recipient"`
	Detail     *string   `json:"detail" db:"detail"`
	OccurredAt time.Time `json:"occurred_at" db:"occurred_at"`
}

// Message is one email, shaped as the public API returns it.
type Message struct {
	Object         string         `json:"object" db:"-"`
	ID             string         `json:"id" db:"id"`
	ThreadID       string         `json:"thread_id" db:"thread_id"`
	MailboxID      string         `json:"mailbox_id" db:"mailbox_id"`
	Mailbox        string         `json:"mailbox" db:"mailbox"`
	RFCMessageID   *string        `json:"message_id" db:"rfc_message_id"`
	InReplyTo      *string        `json:"in_reply_to" db:"in_reply_to"`
	References     []string       `json:"references" db:"references"`
	FromName       *string        `json:"-" db:"from_name"`
	FromAddress    string         `json:"-" db:"from_address"`
	From           addr.Address   `json:"from" db:"-"`
	To             []addr.Address `json:"to" db:"to_addrs"`
	Cc             []addr.Address `json:"cc" db:"cc_addrs"`
	Bcc            []addr.Address `json:"bcc" db:"bcc_addrs"`
	ReplyTo        *string        `json:"reply_to" db:"reply_to"`
	Subject        string         `json:"subject" db:"subject"`
	Snippet        string         `json:"snippet" db:"snippet"`
	Folder         string         `json:"folder" db:"folder"`
	IsOutbound     bool           `json:"-" db:"is_outbound"`
	Direction      string         `json:"direction" db:"-"`
	IsRead         bool           `json:"is_read" db:"is_read"`
	IsStarred      bool           `json:"is_starred" db:"is_starred"`
	IsDraft        bool           `json:"is_draft" db:"is_draft"`
	HasAttachments bool           `json:"has_attachments" db:"has_attachments"`
	SizeBytes      int            `json:"size_bytes" db:"size_bytes"`
	SPF            *string        `json:"spf" db:"spf"`
	DKIM           *string        `json:"dkim" db:"dkim"`
	DMARC          *string        `json:"dmarc" db:"dmarc"`
	SpamScore      *int           `json:"spam_score" db:"spam_score"`
	MailedBy       *string        `json:"mailed_by" db:"mailed_by"`
	SignedBy       *string        `json:"signed_by" db:"signed_by"`
	TLS            *string        `json:"tls" db:"tls"`
	SESMessageID   *string        `json:"ses_message_id" db:"ses_message_id"`
	Status         *string        `json:"status" db:"delivery_status"`
	Error          *string        `json:"error" db:"delivery_error"`
	OpenedAt       *time.Time     `json:"opened_at" db:"opened_at"`
	OpenCount      int            `json:"open_count" db:"open_count"`
	APIKeyID       *string        `json:"api_key_id" db:"api_key_id"`
	RawKey         *string        `json:"-" db:"raw_key"`
	SentAt         *time.Time     `json:"sent_at" db:"sent_at"`
	ReceivedAt     time.Time      `json:"received_at" db:"received_at"`
	CreatedAt      time.Time      `json:"created_at" db:"created_at"`
	Text           *string        `json:"text,omitempty" db:"text_body"`
	HTML           *string        `json:"html,omitempty" db:"html_body"`
	Attachments    []*Attachment  `json:"attachments,omitempty" db:"-"`
	Events         []*Event       `json:"events,omitempty" db:"-"`
}

// messageColumns selects a message; bodies only when withBody.
func messageColumns(withBody bool) string {
	body := `NULL::text AS text_body, NULL::text AS html_body`
	if withBody {
		body = `m.text_body, m.html_body`
	}
	return `m.id, m.thread_id, m.mailbox_id, mb.address AS mailbox, m.rfc_message_id, m.in_reply_to, m."references",
	m.from_name, m.from_address, m.to_addrs, m.cc_addrs, m.bcc_addrs, m.reply_to, m.subject, m.snippet,
	m.folder::text AS folder, m.is_outbound, m.is_read, m.is_starred, m.is_draft,
	EXISTS (SELECT 1 FROM attachment a WHERE a.message_id = m.id AND NOT a.is_inline) AS has_attachments,
	m.size_bytes, m.spf, m.dkim, m.dmarc, m.spam_score, m.mailed_by, m.signed_by, m.tls, m.ses_message_id,
	m.delivery_status::text AS delivery_status, m.delivery_error, m.opened_at, m.open_count, m.api_key_id,
	m.raw_key, m.sent_at, m.received_at, m.created_at, ` + body
}

func (m *Message) finish() {
	m.Object = "message"
	m.From = addr.Address{Address: m.FromAddress}
	if m.FromName != nil {
		m.From.Name = *m.FromName
	}
	m.Direction = "inbound"
	if m.IsOutbound {
		m.Direction = "outbound"
	}
}

// where builds a WHERE clause with numbered placeholders. Conditions use
// "?" for each argument.
type where struct {
	parts []string
	args  []any
}

func (w *where) add(cond string, args ...any) {
	for _, a := range args {
		w.args = append(w.args, a)
		cond = strings.Replace(cond, "?", "$"+strconv.Itoa(len(w.args)), 1)
	}
	w.parts = append(w.parts, cond)
}

// arg adds an argument and returns its placeholder.
func (w *where) arg(a any) string {
	w.args = append(w.args, a)
	return "$" + strconv.Itoa(len(w.args))
}

func (w *where) sql() string {
	if len(w.parts) == 0 {
		return ""
	}
	return "WHERE " + strings.Join(w.parts, " AND ")
}

// scope narrows to allowed mailboxes (nil = all), then optionally to one
// mailbox (id or address) and one domain.
func (w *where) scope(col string, allowed []string, mailbox, domain string) {
	if allowed != nil {
		w.add(col+" = ANY(?)", allowed)
	}
	if mailbox != "" {
		w.add(col+" IN (SELECT id FROM mailbox WHERE id = ? OR address = lower(?))", mailbox, mailbox)
	}
	if domain != "" {
		w.add(col+" IN (SELECT id FROM mailbox WHERE domain = lower(?))", domain)
	}
}
