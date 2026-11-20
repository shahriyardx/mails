// Package webhook delivers events to the owner's HTTP endpoints, signed,
// retried, and recorded attempt by attempt; and manages those endpoints.
package webhook

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/events"
	"github.com/shahriyardx/mails/internal/id"
)

// Events are the names an endpoint can subscribe to. "webhook.test" is
// sent only by a ping and is deliberately not subscribable.
var Events = []string{
	"mail.received", "email.sent", "email.delivered", "email.bounced", "email.complained",
	"email.opened", "email.clicked", "email.delayed", "email.rejected", "email.failed",
	"email.canceled", "thread.updated",
}

const (
	maxAttempts      = 4
	disableAfter     = 20
	attemptTimeout   = 10 * time.Second
	maxResponseBytes = 2048
	staleClaim       = 5 * time.Minute
)

// retryDelays is the wait before attempts 2, 3 and 4.
var retryDelays = []time.Duration{2 * time.Second, 10 * time.Second, 30 * time.Second}

// Doer sends HTTP requests. Production uses a safehttp client.
type Doer interface {
	Do(*http.Request) (*http.Response, error)
}

// Service delivers and manages webhooks. It is the events.Sink the rest of
// the app emits to.
type Service struct {
	DB   *pgxpool.Pool
	HTTP Doer
	Now  func() time.Time
	// AllowLocal permits http://localhost endpoints, for development.
	AllowLocal bool

	once sync.Once
	wake chan struct{}
}

var _ events.Sink = (*Service)(nil)

// Emit queues e for every enabled endpoint that wants it. It only writes
// rows; the worker does the network part.
func (s *Service) Emit(ctx context.Context, e events.Event) {
	data, err := json.Marshal(e.Data)
	if err != nil {
		slog.Error("webhook payload", "event", e.Type, "err", err)
		return
	}
	rows, _ := s.DB.Query(ctx, `SELECT w.id FROM webhook w WHERE w.enabled
		AND ('*' = ANY(w.events) OR $1 = ANY(w.events))
		AND (w.mailbox_id IS NULL OR w.mailbox_id = nullif($2, ''))
		AND (w.domain_id IS NULL OR w.domain_id = (SELECT domain_id FROM mailbox WHERE id = nullif($2, '')))`, e.Type, e.MailboxID)
	hooks, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		slog.Error("find webhooks", "event", e.Type, "err", err)
		return
	}
	for _, hookID := range hooks {
		deliveryID := id.New("whd")
		if _, err := s.DB.Exec(ctx, `INSERT INTO webhook_delivery (id, event_id, webhook_id, event, payload, attempt, next_retry_at)
			VALUES ($1, $1, $2, $3, $4, 1, $5)`, deliveryID, hookID, e.Type, data, s.Now()); err != nil {
			slog.Error("queue webhook", "event", e.Type, "err", err)
		}
	}
	if len(hooks) > 0 {
		s.Wake()
	}
}

func (s *Service) wakeCh() chan struct{} {
	s.once.Do(func() { s.wake = make(chan struct{}, 1) })
	return s.wake
}

// Wake nudges the delivery worker.
func (s *Service) Wake() {
	select {
	case s.wakeCh() <- struct{}{}:
	default:
	}
}

// Run delivers due attempts until ctx ends. Rows are claimed with
// FOR UPDATE SKIP LOCKED, so more than one process may run it.
func (s *Service) Run(ctx context.Context) {
	wake := s.wakeCh()
	tick := time.NewTicker(2 * time.Second)
	defer tick.Stop()
	for {
		for ctx.Err() == nil {
			worked, err := s.DeliverOne(ctx)
			if err != nil {
				slog.Error("webhook delivery", "err", err)
				break
			}
			if !worked {
				break
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-wake:
		case <-tick.C:
		}
	}
}

type pending struct {
	ID, EventID, HookID, Event, URL, Secret string
	Payload                                 json.RawMessage
	Attempt                                 int
	Enabled                                 bool
	CreatedAt                               time.Time
}

// DeliverOne claims and sends one due attempt. It reports whether there was one.
func (s *Service) DeliverOne(ctx context.Context) (bool, error) {
	// An attempt takes at most attemptTimeout; a claim much older than that
	// belongs to a worker that died, so the attempt goes back in the queue.
	if _, err := s.DB.Exec(ctx, `UPDATE webhook_delivery SET next_retry_at = $1, locked_at = NULL
		WHERE locked_at < $2 AND status_code IS NULL AND error IS NULL`, s.Now(), s.Now().Add(-staleClaim)); err != nil {
		return false, fmt.Errorf("release stale deliveries: %w", err)
	}
	var p pending
	err := s.DB.QueryRow(ctx, `WITH d AS (
			UPDATE webhook_delivery SET next_retry_at = NULL, locked_at = $1 WHERE id = (
				SELECT id FROM webhook_delivery WHERE next_retry_at <= $1 ORDER BY next_retry_at FOR UPDATE SKIP LOCKED LIMIT 1)
			RETURNING id, event_id, webhook_id, event, payload, attempt)
		SELECT d.id, d.event_id, d.webhook_id, d.event, w.url, w.secret, d.payload, d.attempt, w.enabled,
			(SELECT created_at FROM webhook_delivery WHERE id = d.event_id)
		FROM d JOIN webhook w ON w.id = d.webhook_id`, s.Now()).
		Scan(&p.ID, &p.EventID, &p.HookID, &p.Event, &p.URL, &p.Secret, &p.Payload, &p.Attempt, &p.Enabled, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim delivery: %w", err)
	}
	if !p.Enabled {
		_, err := s.DB.Exec(ctx, `UPDATE webhook_delivery SET error = 'The endpoint is turned off', locked_at = NULL WHERE id = $1`, p.ID)
		return true, err
	}
	r := s.attempt(ctx, &p)
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	if err := s.record(ctx, &p, r); err != nil {
		return true, err
	}
	if !r.Succeeded && r.retryable && p.Attempt < maxAttempts {
		_, err := s.DB.Exec(ctx, `INSERT INTO webhook_delivery (id, event_id, webhook_id, event, payload, attempt, next_retry_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`, id.New("whd"), p.EventID, p.HookID, p.Event, p.Payload, p.Attempt+1,
			s.Now().Add(retryDelays[p.Attempt-1]))
		if err != nil {
			return true, fmt.Errorf("schedule retry: %w", err)
		}
	}
	return true, nil
}

// Result is one attempt's outcome, in the ping/replay reply shape.
type Result struct {
	Object       string  `json:"object"`
	WebhookID    string  `json:"webhook_id"`
	DeliveryID   string  `json:"delivery_id,omitempty"`
	Succeeded    bool    `json:"succeeded"`
	StatusCode   *int    `json:"status_code"`
	DurationMS   int     `json:"duration_ms"`
	ResponseBody *string `json:"response_body"`
	Error        *string `json:"error"`
	retryable    bool
}

// Sign is the X-Mails-Signature value for body at time t.
func Sign(secret string, t time.Time, body []byte) string {
	ts := strconv.FormatInt(t.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + "."))
	mac.Write(body)
	return "t=" + ts + ",v1=" + hex.EncodeToString(mac.Sum(nil))
}

func (s *Service) attempt(ctx context.Context, p *pending) Result {
	r := Result{Object: "webhook_ping", WebhookID: p.HookID, DeliveryID: p.ID}
	body, _ := json.Marshal(map[string]any{
		"id": p.EventID, "object": "event", "type": p.Event,
		"created_at": p.CreatedAt.UTC().Format(time.RFC3339Nano), "data": p.Payload,
	})
	ctx, cancel := context.WithTimeout(ctx, attemptTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", p.URL, bytes.NewReader(body))
	if err != nil {
		msg := "Not a usable URL"
		r.Error = &msg
		return r
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Mails-Webhooks/1")
	req.Header.Set("X-Mails-Event", p.Event)
	req.Header.Set("X-Mails-Webhook-Id", p.HookID)
	req.Header.Set("X-Mails-Signature", Sign(p.Secret, s.Now(), body))
	start := time.Now()
	res, err := s.HTTP.Do(req)
	r.DurationMS = int(time.Since(start).Milliseconds())
	if err != nil {
		msg := err.Error()
		r.Error, r.retryable = &msg, true
		return r
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes))
	text := string(bytes.ToValidUTF8(b, nil))
	r.StatusCode, r.ResponseBody = &res.StatusCode, &text
	switch {
	case res.StatusCode >= 200 && res.StatusCode < 300:
		r.Succeeded = true
	default:
		msg := fmt.Sprintf("Endpoint replied %d", res.StatusCode)
		r.Error = &msg
		// A 4xx other than 408/429 is the endpoint saying no; repeating it
		// will not change the answer.
		r.retryable = res.StatusCode >= 500 || res.StatusCode == 408 || res.StatusCode == 429
	}
	return r
}

// record writes an attempt's outcome on its row and on the endpoint.
func (s *Service) record(ctx context.Context, p *pending, r Result) error {
	return pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE webhook_delivery SET status_code = $2, response_body = $3, error = $4, duration_ms = $5, succeeded = $6,
			locked_at = NULL WHERE id = $1`, p.ID, r.StatusCode, r.ResponseBody, r.Error, r.DurationMS, r.Succeeded); err != nil {
			return fmt.Errorf("record delivery: %w", err)
		}
		var err error
		if r.Succeeded {
			_, err = tx.Exec(ctx, `UPDATE webhook SET last_status = $2, last_delivered_at = now(), consecutive_failures = 0 WHERE id = $1`,
				p.HookID, r.StatusCode)
		} else {
			_, err = tx.Exec(ctx, `UPDATE webhook SET last_status = $2, last_error_at = now(), last_error = $3,
				consecutive_failures = consecutive_failures + 1, enabled = enabled AND consecutive_failures + 1 < $4 WHERE id = $1`,
				p.HookID, r.StatusCode, r.Error, disableAfter)
		}
		if err != nil {
			return fmt.Errorf("record endpoint state: %w", err)
		}
		return nil
	})
}

// sendNow makes one recorded attempt right away and waits for the answer
// (ping, replay). It is never retried.
func (s *Service) sendNow(ctx context.Context, hookID, event, eventID string, payload json.RawMessage, attempt int) (*Result, error) {
	var p pending
	err := s.DB.QueryRow(ctx, `SELECT id, url, secret FROM webhook WHERE id = $1`, hookID).Scan(&p.HookID, &p.URL, &p.Secret)
	if err != nil {
		return nil, fmt.Errorf("load webhook: %w", err)
	}
	p.ID, p.Event, p.Payload, p.Attempt = id.New("whd"), event, payload, attempt
	p.EventID = eventID
	if p.EventID == "" {
		p.EventID = p.ID
	}
	p.CreatedAt = s.Now()
	if _, err := s.DB.Exec(ctx, `INSERT INTO webhook_delivery (id, event_id, webhook_id, event, payload, attempt) VALUES ($1, $2, $3, $4, $5, $6)`,
		p.ID, p.EventID, p.HookID, p.Event, p.Payload, p.Attempt); err != nil {
		return nil, fmt.Errorf("record attempt: %w", err)
	}
	r := s.attempt(ctx, &p)
	if err := s.record(ctx, &p, r); err != nil {
		return nil, err
	}
	return &r, nil
}

// validEvents checks a subscription list.
func validEvents(list []string) bool {
	for _, e := range list {
		if e != "*" && !slices.Contains(Events, e) {
			return false
		}
	}
	return true
}
