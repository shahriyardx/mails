package delivery

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/id"
	"github.com/shahriyardx/mails/internal/page"
	"github.com/shahriyardx/mails/internal/ses"
)

// ---- Suppressions (the blocked list) --------------------------------------

type Suppression struct {
	Object    string    `json:"object" db:"-"`
	ID        string    `json:"id" db:"id"`
	Address   string    `json:"address" db:"address"`
	Reason    string    `json:"reason" db:"reason"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// ListSuppressions pages the blocked list, newest first. q matches the address.
func (s *Service) ListSuppressions(ctx context.Context, q string, p page.Params) (page.List[*Suppression], error) {
	args := []any{p.Limit + 1}
	where := "WHERE true"
	if q != "" {
		args = append(args, "%"+strings.ToLower(q)+"%")
		where += fmt.Sprintf(" AND address LIKE $%d", len(args))
	}
	if c := p.Cursor; c != nil {
		args = append(args, c.Time(), c.ID)
		where += fmt.Sprintf(" AND (created_at, id) < ($%d, $%d)", len(args)-1, len(args))
	}
	rows, _ := s.DB.Query(ctx, `SELECT id, address, reason, created_at FROM suppression `+where+` ORDER BY created_at DESC, id DESC LIMIT $1`, args...)
	list, err := pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[Suppression])
	if err != nil {
		return page.List[*Suppression]{}, fmt.Errorf("list suppressions: %w", err)
	}
	for _, x := range list {
		x.Object = "suppression"
	}
	return page.Build(list, p.Limit, func(x *Suppression) (int64, string) { return x.CreatedAt.UnixMicro(), x.ID }), nil
}

// Suppress blocks an address by hand. Blocking one already blocked is a 409.
func (s *Service) Suppress(ctx context.Context, address, reason string) (*Suppression, error) {
	address = strings.ToLower(strings.TrimSpace(address))
	if !addr.Valid(address) {
		return nil, httpx.Invalid("address", "address: Not an email address")
	}
	if reason = strings.TrimSpace(reason); reason == "" {
		reason = "manual"
	}
	x := &Suppression{Object: "suppression", ID: id.New("sup"), Address: address, Reason: reason}
	err := s.DB.QueryRow(ctx, `INSERT INTO suppression (id, address, reason) VALUES ($1, $2, $3)
		ON CONFLICT (address) DO NOTHING RETURNING created_at`, x.ID, x.Address, x.Reason).Scan(&x.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.Conflict("That address is already blocked")
	}
	if err != nil {
		return nil, fmt.Errorf("suppress: %w", err)
	}
	return x, nil
}

// Unsuppress removes an address (or suppression id) from the blocked list.
func (s *Service) Unsuppress(ctx context.Context, idOrAddress string) (*Suppression, error) {
	rows, _ := s.DB.Query(ctx, `DELETE FROM suppression WHERE id = $1 OR address = lower($1) RETURNING id, address, reason, created_at`, idOrAddress)
	x, err := pgx.CollectExactlyOneRow(rows, pgx.RowToAddrOfStructByName[Suppression])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.NotFound("That address is not blocked")
	}
	if err != nil {
		return nil, fmt.Errorf("unsuppress: %w", err)
	}
	x.Object = "suppression"
	return x, nil
}

// ---- Delivery log ----------------------------------------------------------

// LogRow is one message in the delivery log.
type LogRow struct {
	ID           string         `json:"id" db:"id"`
	ThreadID     string         `json:"thread_id" db:"thread_id"`
	Subject      string         `json:"subject" db:"subject"`
	From         string         `json:"from" db:"from_address"`
	To           []addr.Address `json:"to" db:"to_addrs"`
	Status       *string        `json:"status" db:"delivery_status"`
	Error        *string        `json:"error" db:"delivery_error"`
	OpenCount    int            `json:"open_count" db:"open_count"`
	APIKeyID     *string        `json:"api_key_id" db:"api_key_id"`
	SESMessageID *string        `json:"ses_message_id" db:"ses_message_id"`
	At           time.Time      `json:"at" db:"at"`
	Mailbox      string         `json:"mailbox" db:"mailbox"`
	MailboxColor string         `json:"mailbox_color" db:"mailbox_color"`
}

// LogFilter narrows the delivery log.
type LogFilter struct {
	Outbound bool
	Query    string
	Status   string
	Days     int
	APIKeyID string
	Page     page.Params
}

// Log lists sent (or received) mail, newest first.
func (s *Service) Log(ctx context.Context, f LogFilter) (page.List[*LogRow], error) {
	when := "m.received_at"
	if f.Outbound {
		when = "coalesce(m.sent_at, m.created_at)"
	}
	args := []any{f.Outbound, f.Page.Limit + 1}
	where := "WHERE m.is_outbound = $1 AND NOT m.is_draft"
	add := func(cond string, vals ...any) {
		for _, v := range vals {
			args = append(args, v)
			cond = strings.Replace(cond, "?", fmt.Sprintf("$%d", len(args)), 1)
		}
		where += " AND " + cond
	}
	if f.Days > 0 {
		add(when+" >= ?", s.Now().Add(-time.Duration(f.Days)*24*time.Hour))
	}
	if f.Status != "" {
		add("m.delivery_status::text = ?", f.Status)
	}
	if f.APIKeyID != "" {
		add("m.api_key_id = ?", f.APIKeyID)
	}
	if q := strings.TrimSpace(f.Query); q != "" {
		like := "%" + q + "%"
		add(`(m.subject ILIKE ? OR m.from_address ILIKE ? OR m.ses_message_id ILIKE ?
			OR EXISTS (SELECT 1 FROM jsonb_array_elements(m.to_addrs) r WHERE r->>'address' ILIKE ?))`, like, like, like, like)
	}
	if c := f.Page.Cursor; c != nil {
		add("("+when+", m.id) < (?, ?)", c.Time(), c.ID)
	}
	rows, _ := s.DB.Query(ctx, `SELECT m.id, m.thread_id, m.subject, m.from_address, m.to_addrs, m.delivery_status::text AS delivery_status,
		m.delivery_error, m.open_count, m.api_key_id, m.ses_message_id, `+when+` AS at, mb.address AS mailbox, mb.color AS mailbox_color
		FROM message m JOIN mailbox mb ON mb.id = m.mailbox_id `+where+` ORDER BY `+when+` DESC, m.id DESC LIMIT $2`, args...)
	list, err := pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[LogRow])
	if err != nil {
		return page.List[*LogRow]{}, fmt.Errorf("delivery log: %w", err)
	}
	return page.Build(list, f.Page.Limit, func(r *LogRow) (int64, string) { return r.At.UnixMicro(), r.ID }), nil
}

// ---- Metrics ---------------------------------------------------------------

// Day is one day of sending.
type Day struct {
	Day        string `json:"day"`
	Sent       int    `json:"sent"`
	Delivered  int    `json:"delivered"`
	Bounced    int    `json:"bounced"`
	Complained int    `json:"complained"`
	Opened     int    `json:"opened"`
}

// Kind is a count of one bounce or complaint type.
type Kind struct {
	Kind  string  `json:"kind"`
	Count int     `json:"count"`
	Rate  float64 `json:"rate"`
}

// Metrics is the sending report over a range of days.
type Metrics struct {
	Range          int      `json:"range"`
	DomainID       string   `json:"domain_id,omitempty"`
	Days           []Day    `json:"days"`
	Totals         Day      `json:"totals"`
	Deliverability *float64 `json:"deliverability"`
	BounceRate     *float64 `json:"bounce_rate"`
	ComplaintRate  *float64 `json:"complaint_rate"`
	OpenRate       *float64 `json:"open_rate"`
	Bounces        []Kind   `json:"bounces"`
	Complaints     []Kind   `json:"complaints"`
}

// Metrics counts outbound mail per UTC day for the last rangeDays days.
func (s *Service) Metrics(ctx context.Context, rangeDays int, domainID string) (*Metrics, error) {
	if rangeDays < 1 || rangeDays > 365 {
		rangeDays = 30
	}
	start := s.Now().UTC().Truncate(24*time.Hour).AddDate(0, 0, -(rangeDays - 1))
	m := &Metrics{Range: rangeDays, DomainID: domainID, Bounces: []Kind{}, Complaints: []Kind{}}
	index := map[string]int{}
	for i := range rangeDays {
		d := start.AddDate(0, 0, i).Format("2006-01-02")
		index[d] = i
		m.Days = append(m.Days, Day{Day: d})
	}
	scope := `m.is_outbound AND NOT m.is_draft AND coalesce(m.sent_at, m.created_at) >= $1
		AND ($2 = '' OR m.mailbox_id IN (SELECT id FROM mailbox WHERE domain_id = $2))`
	rows, _ := s.DB.Query(ctx, `SELECT to_char(coalesce(m.sent_at, m.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
		count(*) FILTER (WHERE m.delivery_status IN ('sent', 'delivered', 'bounced', 'complained', 'delayed')),
		count(*) FILTER (WHERE m.delivery_status IN ('delivered', 'complained')),
		count(*) FILTER (WHERE m.delivery_status = 'bounced'),
		count(*) FILTER (WHERE m.delivery_status = 'complained'),
		count(*) FILTER (WHERE m.opened_at IS NOT NULL)
		FROM message m WHERE `+scope+` GROUP BY 1`, start, domainID)
	var d Day
	if _, err := pgx.ForEachRow(rows, []any{&d.Day, &d.Sent, &d.Delivered, &d.Bounced, &d.Complained, &d.Opened}, func() error {
		if i, ok := index[d.Day]; ok {
			m.Days[i] = d
		}
		return nil
	}); err != nil {
		return nil, fmt.Errorf("metrics: %w", err)
	}
	for _, day := range m.Days {
		m.Totals.Sent += day.Sent
		m.Totals.Delivered += day.Delivered
		m.Totals.Bounced += day.Bounced
		m.Totals.Complained += day.Complained
		m.Totals.Opened += day.Opened
	}
	m.Deliverability = share(m.Totals.Delivered, m.Totals.Sent)
	m.BounceRate = share(m.Totals.Bounced, m.Totals.Sent)
	m.ComplaintRate = share(m.Totals.Complained, m.Totals.Sent)
	m.OpenRate = share(m.Totals.Opened, m.Totals.Delivered)

	for typ, dst := range map[string]*[]Kind{"bounce": &m.Bounces, "complaint": &m.Complaints} {
		label := `coalesce(nullif(split_part(e.detail, '/', 1), ''), 'Undetermined')`
		if typ == "complaint" {
			label = `coalesce(nullif(e.detail, ''), 'Complained')`
		}
		rows, _ := s.DB.Query(ctx, `SELECT `+label+`, count(*) FROM message_event e JOIN message m ON m.id = e.message_id
			WHERE e.type = '`+typ+`' AND `+scope+` GROUP BY 1 ORDER BY 2 DESC`, start, domainID)
		var k Kind
		if _, err := pgx.ForEachRow(rows, []any{&k.Kind, &k.Count}, func() error {
			if r := share(k.Count, m.Totals.Sent); r != nil {
				k.Rate = *r
			}
			*dst = append(*dst, k)
			return nil
		}); err != nil {
			return nil, fmt.Errorf("metrics %s kinds: %w", typ, err)
		}
	}
	return m, nil
}

func share(part, whole int) *float64 {
	if whole == 0 {
		return nil
	}
	v := float64(part) / float64(whole)
	return &v
}

// ---- Overview --------------------------------------------------------------

// Overview is the SES account at a glance.
type Overview struct {
	Account *ses.Account `json:"account"`
	Error   string       `json:"error,omitempty"`
	Sent24h int          `json:"sent_24h"`
	Queued  int          `json:"queued"`
	Failed  int          `json:"failed_7d"`
	Blocked int          `json:"blocked"`
}

// GetOverview asks SES for the account's standing and counts what is local.
// SES being unreachable is reported, not fatal.
func (s *Service) GetOverview(ctx context.Context) (*Overview, error) {
	o := &Overview{}
	if a, err := s.SES.Account(ctx); err != nil {
		o.Error = err.Error()
	} else {
		o.Account = a
	}
	err := s.DB.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM message WHERE is_outbound AND sent_at > now() - interval '1 day'),
		(SELECT count(*) FROM send_job WHERE status IN ('pending', 'sending')),
		(SELECT count(*) FROM message WHERE is_outbound AND delivery_status IN ('failed', 'bounced', 'rejected') AND created_at > now() - interval '7 days'),
		(SELECT count(*) FROM suppression)`).Scan(&o.Sent24h, &o.Queued, &o.Failed, &o.Blocked)
	if err != nil {
		return nil, fmt.Errorf("overview counts: %w", err)
	}
	return o, nil
}
