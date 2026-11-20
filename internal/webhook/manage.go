package webhook

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/id"
	"github.com/shahriyardx/mails/internal/page"
	"github.com/shahriyardx/mails/internal/safehttp"
)

// Webhook is an endpoint, shaped as the API returns it. Secret is set only
// on create and rotate.
type Webhook struct {
	Object              string     `json:"object"`
	ID                  string     `json:"id"`
	URL                 string     `json:"url"`
	Description         *string    `json:"description"`
	Events              []string   `json:"events"`
	Enabled             bool       `json:"enabled"`
	MailboxID           *string    `json:"mailbox_id"`
	DomainID            *string    `json:"domain_id"`
	LastStatus          *int       `json:"last_status"`
	LastDeliveredAt     *time.Time `json:"last_delivered_at"`
	LastErrorAt         *time.Time `json:"last_error_at"`
	LastError           *string    `json:"last_error"`
	ConsecutiveFailures int        `json:"consecutive_failures"`
	CreatedAt           time.Time  `json:"created_at"`
	Secret              string     `json:"secret,omitempty"`
}

const hookColumns = `id, url, description, events, enabled, mailbox_id, domain_id, last_status, last_delivered_at,
	last_error_at, last_error, consecutive_failures, created_at`

func scanHook(r pgx.CollectableRow) (*Webhook, error) {
	w := &Webhook{Object: "webhook"}
	return w, r.Scan(&w.ID, &w.URL, &w.Description, &w.Events, &w.Enabled, &w.MailboxID, &w.DomainID, &w.LastStatus,
		&w.LastDeliveredAt, &w.LastErrorAt, &w.LastError, &w.ConsecutiveFailures, &w.CreatedAt)
}

// Scope limits which endpoints a caller sees: those on one of its
// mailboxes or one of its domains. A nil *Scope sees every endpoint.
type Scope struct {
	MailboxIDs []string
	DomainIDs  []string
}

func (sc *Scope) has(mailboxID, domainID *string) bool {
	return sc == nil || (mailboxID != nil && contains(sc.MailboxIDs, *mailboxID)) ||
		(domainID != nil && contains(sc.DomainIDs, *domainID))
}

// visibleClause is sc as SQL over webhook columns prefixed by col.
func visibleClause(sc *Scope, col string) (string, []any) {
	if sc == nil {
		return "true", nil
	}
	return "(" + col + "mailbox_id = ANY($1) OR " + col + "domain_id = ANY($2))", []any{nonNil(sc.MailboxIDs), nonNil(sc.DomainIDs)}
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// List returns endpoints. visible narrows to those scoped to one of those
// mailboxes (a restricted key); nil lists every endpoint.
func (s *Service) List(ctx context.Context, visible *Scope) ([]*Webhook, error) {
	cond, args := visibleClause(visible, "")
	rows, _ := s.DB.Query(ctx, `SELECT `+hookColumns+` FROM webhook WHERE `+cond+` ORDER BY created_at`, args...)
	return pgx.CollectRows(rows, scanHook)
}

func (s *Service) Get(ctx context.Context, visible *Scope, hookID string) (*Webhook, error) {
	cond, args := visibleClause(visible, "")
	args = append(args, hookID)
	rows, _ := s.DB.Query(ctx, fmt.Sprintf(`SELECT `+hookColumns+` FROM webhook WHERE %s AND id = $%d`, cond, len(args)), args...)
	w, err := pgx.CollectExactlyOneRow(rows, scanHook)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.NotFound("No such webhook")
	}
	return w, err
}

// Input creates an endpoint.
type Input struct {
	URL         string   `json:"url" validate:"required,max=2000"`
	Description *string  `json:"description" validate:"omitempty,max=500"`
	Events      []string `json:"events"`
	MailboxID   *string  `json:"mailbox_id"`
	DomainID    *string  `json:"domain_id"`
	Enabled     *bool    `json:"enabled"`
}

func (s *Service) checkURL(ctx context.Context, u string) error {
	if err := safehttp.CheckURL(ctx, u, s.AllowLocal); err != nil {
		return httpx.Invalid("url", "url: "+err.Error())
	}
	return nil
}

func newSecret() string { return "whsec_" + id.Token(24) }

// Create stores an endpoint and returns it with its secret, once.
func (s *Service) Create(ctx context.Context, in Input) (*Webhook, error) {
	if err := httpx.Validate(in); err != nil {
		return nil, err
	}
	if err := s.checkURL(ctx, in.URL); err != nil {
		return nil, err
	}
	if len(in.Events) == 0 {
		in.Events = []string{"*"}
	}
	if !validEvents(in.Events) {
		return nil, httpx.Invalid("events", "events: Unknown event name")
	}
	if in.MailboxID != nil && in.DomainID != nil {
		return nil, httpx.Invalid("mailbox_id", "Give mailbox_id or domain_id, not both")
	}
	enabled := in.Enabled == nil || *in.Enabled
	w := &Webhook{}
	secret := newSecret()
	hookID := id.New("whk")
	_, err := s.DB.Exec(ctx, `INSERT INTO webhook (id, url, description, events, secret, enabled, mailbox_id, domain_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, hookID, in.URL, in.Description, in.Events, secret, enabled, in.MailboxID, in.DomainID)
	if err != nil {
		return nil, httpx.Invalid("mailbox_id", "Unknown mailbox or domain")
	}
	if w, err = s.Get(ctx, nil, hookID); err != nil {
		return nil, err
	}
	w.Secret = secret
	return w, nil
}

// Patch changes an endpoint. Turning it on clears its failure count.
type Patch struct {
	URL          *string           `json:"url" validate:"omitempty,max=2000"`
	Description  httpx.Opt[string] `json:"description"`
	Events       []string          `json:"events"`
	Enabled      *bool             `json:"enabled"`
	RotateSecret bool              `json:"rotate_secret"`
	MailboxID    httpx.Opt[string] `json:"mailbox_id"`
	DomainID     httpx.Opt[string] `json:"domain_id"`
}

func (s *Service) Update(ctx context.Context, visible *Scope, hookID string, p Patch) (*Webhook, error) {
	w, err := s.Get(ctx, visible, hookID)
	if err != nil {
		return nil, err
	}
	if p.URL != nil {
		if err := s.checkURL(ctx, *p.URL); err != nil {
			return nil, err
		}
		w.URL = *p.URL
	}
	if p.Description.Set {
		w.Description = p.Description.Ptr()
	}
	if p.Events != nil {
		if len(p.Events) == 0 || !validEvents(p.Events) {
			return nil, httpx.Invalid("events", "events: Unknown event name")
		}
		w.Events = p.Events
	}
	if p.MailboxID.Set {
		w.MailboxID = p.MailboxID.Ptr()
	}
	if p.DomainID.Set {
		w.DomainID = p.DomainID.Ptr()
	}
	if w.MailboxID != nil && w.DomainID != nil {
		return nil, httpx.Invalid("mailbox_id", "Give mailbox_id or domain_id, not both")
	}
	reenable := p.Enabled != nil && *p.Enabled && !w.Enabled
	if p.Enabled != nil {
		w.Enabled = *p.Enabled
	}
	var secret *string
	if p.RotateSecret {
		v := newSecret()
		secret = &v
	}
	_, err = s.DB.Exec(ctx, `UPDATE webhook SET url = $2, description = $3, events = $4, enabled = $5, mailbox_id = $6, domain_id = $7,
		secret = coalesce($8, secret), consecutive_failures = CASE WHEN $9 THEN 0 ELSE consecutive_failures END WHERE id = $1`,
		w.ID, w.URL, w.Description, w.Events, w.Enabled, w.MailboxID, w.DomainID, secret, reenable)
	if err != nil {
		return nil, httpx.Invalid("mailbox_id", "Unknown mailbox or domain")
	}
	if w, err = s.Get(ctx, nil, w.ID); err != nil {
		return nil, err
	}
	if secret != nil {
		w.Secret = *secret
	}
	return w, nil
}

// Delete removes an endpoint and its deliveries, or only turns it off.
func (s *Service) Delete(ctx context.Context, visible *Scope, hookID string, disableOnly bool) error {
	w, err := s.Get(ctx, visible, hookID)
	if err != nil {
		return err
	}
	if disableOnly {
		_, err = s.DB.Exec(ctx, `UPDATE webhook SET enabled = false WHERE id = $1`, w.ID)
	} else {
		_, err = s.DB.Exec(ctx, `DELETE FROM webhook WHERE id = $1`, w.ID)
	}
	return err
}

// Ping sends a webhook.test event and waits for the answer.
func (s *Service) Ping(ctx context.Context, visible *Scope, hookID string) (*Result, error) {
	w, err := s.Get(ctx, visible, hookID)
	if err != nil {
		return nil, err
	}
	payload, _ := json.Marshal(map[string]any{"message": "This is a test from Mails.", "webhook_id": w.ID})
	return s.sendNow(ctx, w.ID, "webhook.test", "", payload, 1)
}

// Delivery is one recorded attempt.
type Delivery struct {
	Object       string          `json:"object"`
	ID           string          `json:"id"`
	EventID      string          `json:"event_id"`
	WebhookID    string          `json:"webhook_id"`
	Event        string          `json:"event"`
	Payload      json.RawMessage `json:"payload"`
	Attempt      int             `json:"attempt"`
	StatusCode   *int            `json:"status_code"`
	ResponseBody *string         `json:"response_body"`
	Error        *string         `json:"error"`
	DurationMS   *int            `json:"duration_ms"`
	Succeeded    bool            `json:"succeeded"`
	NextRetryAt  *time.Time      `json:"next_retry_at"`
	CreatedAt    time.Time       `json:"created_at"`
}

// DeliveryFilter narrows the delivery list.
type DeliveryFilter struct {
	Visible   *Scope
	WebhookID string
	Event     string
	Succeeded *bool
	Page      page.Params
}

func (s *Service) Deliveries(ctx context.Context, f DeliveryFilter) (page.List[*Delivery], error) {
	conds := []string{"true"}
	var args []any
	add := func(cond string, v any) {
		args = append(args, v)
		conds = append(conds, strings.ReplaceAll(cond, "?", fmt.Sprintf("$%d", len(args))))
	}
	if f.Visible != nil {
		args = append(args, nonNil(f.Visible.MailboxIDs), nonNil(f.Visible.DomainIDs))
		conds = append(conds, fmt.Sprintf("(w.mailbox_id = ANY($%d) OR w.domain_id = ANY($%d))", len(args)-1, len(args)))
	}
	if f.WebhookID != "" {
		add("d.webhook_id = ?", f.WebhookID)
	}
	if f.Event != "" {
		add("d.event = ?", f.Event)
	}
	if f.Succeeded != nil {
		add("d.succeeded = ?", *f.Succeeded)
	}
	if c := f.Page.Cursor; c != nil {
		args = append(args, c.Time(), c.ID)
		conds = append(conds, fmt.Sprintf("(d.created_at, d.id) < ($%d, $%d)", len(args)-1, len(args)))
	}
	args = append(args, f.Page.Limit+1)
	rows, _ := s.DB.Query(ctx, fmt.Sprintf(`SELECT d.id, d.event_id, d.webhook_id, d.event, d.payload, d.attempt, d.status_code,
		d.response_body, d.error, d.duration_ms, d.succeeded, d.next_retry_at, d.created_at
		FROM webhook_delivery d JOIN webhook w ON w.id = d.webhook_id WHERE %s ORDER BY d.created_at DESC, d.id DESC LIMIT $%d`,
		strings.Join(conds, " AND "), len(args)), args...)
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (*Delivery, error) {
		d := &Delivery{Object: "webhook_delivery"}
		return d, r.Scan(&d.ID, &d.EventID, &d.WebhookID, &d.Event, &d.Payload, &d.Attempt, &d.StatusCode,
			&d.ResponseBody, &d.Error, &d.DurationMS, &d.Succeeded, &d.NextRetryAt, &d.CreatedAt)
	})
	if err != nil {
		return page.List[*Delivery]{}, fmt.Errorf("list deliveries: %w", err)
	}
	return page.Build(list, f.Page.Limit, func(d *Delivery) (int64, string) { return d.CreatedAt.UnixMicro(), d.ID }), nil
}

// Replay sends a stored delivery's payload again, under the same event id,
// and waits for the answer.
func (s *Service) Replay(ctx context.Context, visible *Scope, deliveryID string) (*Result, error) {
	var hookID, event, eventID string
	var payload json.RawMessage
	var attempt int
	var mailboxID, domainID *string
	err := s.DB.QueryRow(ctx, `SELECT d.webhook_id, d.event, d.event_id, d.payload, w.mailbox_id, w.domain_id,
		(SELECT max(attempt) FROM webhook_delivery x WHERE x.event_id = d.event_id)
		FROM webhook_delivery d JOIN webhook w ON w.id = d.webhook_id WHERE d.id = $1`, deliveryID).
		Scan(&hookID, &event, &eventID, &payload, &mailboxID, &domainID, &attempt)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !visible.has(mailboxID, domainID)) {
		return nil, httpx.NotFound("No such delivery")
	}
	if err != nil {
		return nil, fmt.Errorf("load delivery: %w", err)
	}
	var enabled bool
	if err := s.DB.QueryRow(ctx, `SELECT enabled FROM webhook WHERE id = $1`, hookID).Scan(&enabled); err != nil {
		return nil, fmt.Errorf("load webhook: %w", err)
	}
	if !enabled {
		return nil, httpx.Conflict("The endpoint is turned off. Turn it on, then replay")
	}
	return s.sendNow(ctx, hookID, event, eventID, payload, attempt+1)
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}
