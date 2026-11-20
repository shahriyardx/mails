package apiv1

import (
	"math"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shahriyardx/mails/internal/httpx"
)

type sending struct {
	Sent          int     `json:"sent"`
	Delivered     int     `json:"delivered"`
	Bounced       int     `json:"bounced"`
	Complained    int     `json:"complained"`
	Failed        int     `json:"failed"`
	Opened        int     `json:"opened"`
	TotalOpens    int     `json:"total_opens"`
	BounceRate    float64 `json:"bounce_rate"`
	ComplaintRate float64 `json:"complaint_rate"`
	OpenRate      float64 `json:"open_rate"`
}

type statDay struct {
	Day       string `json:"day"`
	Sent      int    `json:"sent"`
	Received  int    `json:"received"`
	Delivered int    `json:"delivered"`
	Bounced   int    `json:"bounced"`
	Opened    int    `json:"opened"`
}

type statMailbox struct {
	ID       string `json:"id"`
	Address  string `json:"address"`
	Sent     int    `json:"sent"`
	Received int    `json:"received"`
}

// pct is part of whole out of 100, two decimals.
func pct(part, whole int) float64 {
	if whole == 0 {
		return 0
	}
	return math.Round(float64(part)*10000/float64(whole)) / 100
}

func (a *API) stats(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	q := r.URL.Query()
	ctx := r.Context()
	until := time.Now().UTC()
	days := atoiDefault(q.Get("days"), 30)
	if days < 1 || days > 365 {
		return 0, nil, httpx.Invalid("days", "days: 1 to 365")
	}
	parse := func(name string, dst *time.Time) error {
		v := q.Get(name)
		if v == "" {
			return nil
		}
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			if t, err = time.Parse("2006-01-02", v); err != nil {
				return httpx.Invalid(name, name+": An ISO 8601 date")
			}
		}
		*dst = t
		return nil
	}
	if err := parse("until", &until); err != nil {
		return 0, nil, err
	}
	since := until.AddDate(0, 0, -days) // without since: days long, ending at until
	if err := parse("since", &since); err != nil {
		return 0, nil, err
	}
	// The daily series has a row per day: keep it to about a year.
	if since.After(until) || until.Sub(since) > 366*24*time.Hour {
		return 0, nil, httpx.Invalid("since", "since: At most 366 days before until, and not after it")
	}
	allowed, err := a.reach(ctx, c)
	if err != nil {
		return 0, nil, err
	}
	if ref := firstOf(q.Get("mailbox_id"), q.Get("mailbox")); ref != "" {
		id, err := a.mailboxInReach(ctx, c, ref)
		if err != nil {
			return 0, nil, err
		}
		allowed = []string{id}
	}
	if d := q.Get("domain"); d != "" {
		rows, _ := a.DB.Query(ctx, `SELECT id FROM mailbox WHERE domain = lower($1) AND ($2::text[] IS NULL OR id = ANY($2))`, d, allowed)
		if allowed, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return 0, nil, err
		}
		if allowed == nil {
			allowed = []string{}
		}
	}
	scope := `($3::text[] IS NULL OR m.mailbox_id = ANY($3)) AND NOT m.is_draft`

	var s sending
	err = a.DB.QueryRow(ctx, `SELECT
		count(*) FILTER (WHERE delivery_status NOT IN ('queued', 'canceled', 'failed')),
		count(*) FILTER (WHERE delivery_status IN ('delivered', 'complained')),
		count(*) FILTER (WHERE delivery_status = 'bounced'),
		count(*) FILTER (WHERE delivery_status = 'complained'),
		count(*) FILTER (WHERE delivery_status = 'failed'),
		count(*) FILTER (WHERE opened_at IS NOT NULL),
		coalesce(sum(open_count), 0)
		FROM message m WHERE m.is_outbound AND m.created_at >= $1 AND m.created_at < $2 AND `+scope, since, until, allowed).
		Scan(&s.Sent, &s.Delivered, &s.Bounced, &s.Complained, &s.Failed, &s.Opened, &s.TotalOpens)
	if err != nil {
		return 0, nil, err
	}
	s.BounceRate, s.ComplaintRate, s.OpenRate = pct(s.Bounced, s.Sent), pct(s.Complained, s.Sent), pct(s.Opened, s.Sent)

	var received, threads, unread, drafts int
	var bytes int64
	err = a.DB.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM message m WHERE NOT m.is_outbound AND m.received_at >= $1 AND m.received_at < $2 AND `+scope+`),
		(SELECT count(DISTINCT m.thread_id) FROM message m WHERE NOT m.is_outbound AND m.received_at >= $1 AND m.received_at < $2 AND `+scope+`),
		(SELECT count(*) FROM thread t WHERE t.unread_count > 0 AND t.folders @> '{inbox}' AND ($3::text[] IS NULL OR t.mailbox_id = ANY($3))),
		(SELECT count(*) FROM message m WHERE m.is_draft AND ($3::text[] IS NULL OR m.mailbox_id = ANY($3))),
		(SELECT coalesce(sum(m.size_bytes), 0) FROM message m WHERE ($3::text[] IS NULL OR m.mailbox_id = ANY($3)))`,
		since, until, allowed).Scan(&received, &threads, &unread, &drafts, &bytes)
	if err != nil {
		return 0, nil, err
	}

	rows, _ := a.DB.Query(ctx, `SELECT to_char(day, 'YYYY-MM-DD'),
		count(*) FILTER (WHERE m.is_outbound AND m.delivery_status NOT IN ('queued', 'canceled', 'failed')),
		count(*) FILTER (WHERE NOT m.is_outbound),
		count(*) FILTER (WHERE m.is_outbound AND m.delivery_status IN ('delivered', 'complained')),
		count(*) FILTER (WHERE m.is_outbound AND m.delivery_status = 'bounced'),
		count(*) FILTER (WHERE m.is_outbound AND m.opened_at IS NOT NULL)
		FROM message m, date_trunc('day', m.received_at AT TIME ZONE 'UTC') day
		WHERE m.received_at >= $1 AND m.received_at < $2 AND `+scope+` GROUP BY day ORDER BY day`, since, until, allowed)
	dayList, err := pgx.CollectRows(rows, pgx.RowToStructByPos[statDay])
	if err != nil {
		return 0, nil, err
	}
	rows, _ = a.DB.Query(ctx, `SELECT mb.id, mb.address,
		count(m.id) FILTER (WHERE m.is_outbound AND m.delivery_status NOT IN ('queued', 'canceled', 'failed')),
		count(m.id) FILTER (WHERE NOT m.is_outbound)
		FROM mailbox mb LEFT JOIN message m ON m.mailbox_id = mb.id AND m.received_at >= $1 AND m.received_at < $2 AND NOT m.is_draft
		WHERE ($3::text[] IS NULL OR mb.id = ANY($3)) GROUP BY mb.id ORDER BY mb.address`, since, until, allowed)
	boxes, err := pgx.CollectRows(rows, pgx.RowToStructByPos[statMailbox])
	if err != nil {
		return 0, nil, err
	}
	// One row per day in the window, mail or not, so charts need no gaps.
	byDay := make(map[string]statDay, len(dayList))
	for _, d := range dayList {
		byDay[d.Day] = d
	}
	dayList = []statDay{}
	for d := since.UTC().Truncate(24 * time.Hour); d.Before(until); d = d.AddDate(0, 0, 1) {
		key := d.Format("2006-01-02")
		row, ok := byDay[key]
		if !ok {
			row = statDay{Day: key}
		}
		dayList = append(dayList, row)
	}
	if boxes == nil {
		boxes = []statMailbox{}
	}
	return 200, map[string]any{
		"object": "stats", "since": since, "until": until, "sending": s,
		"receiving": map[string]int{"received": received, "threads": threads, "unread": unread},
		"drafts":    drafts, "bytes": bytes, "days": dayList, "mailboxes": boxes,
	}, nil
}

func firstOf(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
