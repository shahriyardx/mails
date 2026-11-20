// Package push sends Web Push notifications to the owner's browsers when
// mail arrives.
package push

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/id"
	"github.com/shahriyardx/mails/internal/inbound"
	"github.com/shahriyardx/mails/internal/safehttp"
)

// giveUpAfter drops a browser that failed this many sends in a row.
const giveUpAfter = 8

// Payload is what the service worker shows.
type Payload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag,omitempty"`
}

// Subscription is a browser's push endpoint and keys.
type Subscription struct {
	Endpoint string `json:"endpoint"`
	P256dh   string `json:"p256dh"`
	Auth     string `json:"auth"`
}

// Sender delivers one message and returns the push service's status.
type Sender func(ctx context.Context, sub Subscription, payload []byte) (int, error)

// Service keeps subscriptions and sends.
type Service struct {
	DB        *pgxpool.Pool
	PublicKey string
	Send      Sender // nil when VAPID keys are not set: push is off
	// CheckURL vets an endpoint before it is stored; nil uses safehttp.
	CheckURL func(ctx context.Context, endpoint string) error
}

// WebPush is the real Sender. The endpoint comes from a browser, so the
// client refuses private and loopback addresses (see safehttp).
func WebPush(publicKey, privateKey, subject string) Sender {
	client := safehttp.Client(15*time.Second, false)
	return func(ctx context.Context, sub Subscription, payload []byte) (int, error) {
		res, err := webpush.SendNotificationWithContext(ctx, payload,
			&webpush.Subscription{Endpoint: sub.Endpoint, Keys: webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth}},
			&webpush.Options{Subscriber: subject, TTL: 3600, VAPIDPublicKey: publicKey, VAPIDPrivateKey: privateKey, HTTPClient: client})
		if err != nil {
			return 0, err
		}
		res.Body.Close()
		return res.StatusCode, nil
	}
}

// Subscribe remembers a browser. Re-subscribing refreshes its keys.
func (s *Service) Subscribe(ctx context.Context, sub Subscription, label string) error {
	check := s.CheckURL
	if check == nil {
		check = func(ctx context.Context, u string) error { return safehttp.CheckURL(ctx, u, false) }
	}
	if sub.P256dh == "" || sub.Auth == "" || check(ctx, sub.Endpoint) != nil {
		return httpx.Invalid("endpoint", "Not a push subscription")
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO push_subscription (id, endpoint, p256dh, auth, label) VALUES ($1, $2, $3, $4, nullif($5, ''))
		ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label,
			failures = 0, last_seen_at = now()`, id.New("psh"), sub.Endpoint, sub.P256dh, sub.Auth, label)
	if err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}
	return nil
}

// Unsubscribe forgets a browser by endpoint, or every browser when "".
func (s *Service) Unsubscribe(ctx context.Context, endpoint string) error {
	_, err := s.DB.Exec(ctx, `DELETE FROM push_subscription WHERE $1 = '' OR endpoint = $1`, endpoint)
	return err
}

// Browser is a subscribed browser as the settings page lists it.
type Browser struct {
	ID         string    `json:"id"`
	Label      *string   `json:"label"`
	Endpoint   string    `json:"endpoint"`
	CreatedAt  time.Time `json:"created_at"`
	LastSeenAt time.Time `json:"last_seen_at"`
}

func (s *Service) Browsers(ctx context.Context) ([]Browser, error) {
	rows, _ := s.DB.Query(ctx, `SELECT id, label, endpoint, created_at, last_seen_at FROM push_subscription ORDER BY created_at`)
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Browser])
}

// Notify sends p to every browser. Gone endpoints (404/410) are dropped at
// once, others after repeated failures.
func (s *Service) Notify(ctx context.Context, p Payload) {
	if s.Send == nil {
		return
	}
	body, _ := json.Marshal(p)
	type row struct {
		ID string
		Subscription
		Failures int
	}
	rows, _ := s.DB.Query(ctx, `SELECT id, endpoint, p256dh, auth, failures FROM push_subscription`)
	subs, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (row, error) {
		var x row
		return x, r.Scan(&x.ID, &x.Endpoint, &x.P256dh, &x.Auth, &x.Failures)
	})
	if err != nil {
		slog.Error("load push subscriptions", "err", err)
		return
	}
	for _, sub := range subs {
		status, err := s.Send(ctx, sub.Subscription, body)
		switch {
		case status == 404 || status == 410:
			_, err = s.DB.Exec(ctx, `DELETE FROM push_subscription WHERE id = $1`, sub.ID)
		case err != nil || status >= 400:
			var failures int
			if err = s.DB.QueryRow(ctx, `UPDATE push_subscription SET failures = failures + 1 WHERE id = $1 RETURNING failures`, sub.ID).Scan(&failures); err == nil && failures >= giveUpAfter {
				_, err = s.DB.Exec(ctx, `DELETE FROM push_subscription WHERE id = $1`, sub.ID)
			}
		case sub.Failures > 0:
			_, err = s.DB.Exec(ctx, `UPDATE push_subscription SET failures = 0, last_seen_at = now() WHERE id = $1`, sub.ID)
		}
		if err != nil {
			slog.Warn("push bookkeeping", "err", err)
		}
	}
}

// OnReceived is an inbound hook: one notice per stored message, sent in the
// background so a slow push service never holds up the worker. Spam is
// not announced.
func (s *Service) OnReceived(_ context.Context, r inbound.Received) {
	if s.Send == nil || r.Folder == "spam" || r.Folder == "trash" {
		return
	}
	p := Payload{Title: r.From.Display(), Body: r.Subject, URL: "/mail/all/inbox?t=" + url.QueryEscape(r.ThreadID), Tag: "thread:" + r.ThreadID}
	if p.Title == "" {
		p.Title = "New mail"
	}
	if p.Body == "" {
		p.Body = "(no subject)"
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		s.Notify(ctx, p)
	}()
}

// Routes is the dashboard API, mounted at /api/app/push.
func Routes(s *Service) http.Handler {
	r := chi.NewRouter()
	r.Method("GET", "/", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		list, err := s.Browsers(r.Context())
		if err != nil {
			return err
		}
		if list == nil {
			list = []Browser{}
		}
		httpx.JSON(w, 200, map[string]any{"enabled": s.Send != nil, "public_key": s.PublicKey, "browsers": list})
		return nil
	}))
	r.Method("POST", "/subscribe", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			Endpoint string `json:"endpoint" validate:"required,max=2000"`
			Keys     struct {
				P256dh string `json:"p256dh" validate:"required"`
				Auth   string `json:"auth" validate:"required"`
			} `json:"keys"`
			Label string `json:"label" validate:"max=100"`
		}
		if err := httpx.Bind(r, &in); err != nil {
			return err
		}
		if err := s.Subscribe(r.Context(), Subscription{in.Endpoint, in.Keys.P256dh, in.Keys.Auth}, in.Label); err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}))
	r.Method("POST", "/unsubscribe", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			Endpoint string `json:"endpoint"`
		}
		if err := httpx.Bind(r, &in); err != nil {
			return err
		}
		if err := s.Unsubscribe(r.Context(), in.Endpoint); err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}))
	r.Method("POST", "/test", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		if s.Send == nil {
			return httpx.Invalid("", "Push is off: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY")
		}
		s.Notify(r.Context(), Payload{Title: "Mails", Body: "Notifications work on this browser.", URL: "/"})
		w.WriteHeader(http.StatusNoContent)
		return nil
	}))
	return r
}
