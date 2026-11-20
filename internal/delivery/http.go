package delivery

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/page"
)

// SNSHandler serves POST /api/ses/events. Only notifications from the
// configured topic, signed by AWS, are accepted: any AWS account can sign
// messages for a topic of its own, so the topic check is what makes a
// valid signature mean "our SES".
func SNSHandler(s *Service, v *Verifier, topic func() string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		topicARN := topic()
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 256<<10))
		if err != nil {
			httpx.JSON(w, 400, map[string]string{"error": "unreadable body"})
			return
		}
		var e Envelope
		if err := json.Unmarshal(body, &e); err != nil {
			httpx.JSON(w, 400, map[string]string{"error": "invalid json"})
			return
		}
		if topicARN == "" {
			slog.Warn("SNS message refused: set up delivery reporting (Settings -> Reporting) or SES_SNS_TOPIC_ARN", "topic", e.TopicArn)
			httpx.JSON(w, 403, map[string]string{"error": "Delivery reporting is not set up on this instance"})
			return
		}
		if e.TopicArn != topicARN {
			httpx.JSON(w, 403, map[string]string{"error": "unexpected topic"})
			return
		}
		if err := v.Verify(r.Context(), &e); err != nil {
			slog.Warn("SNS signature refused", "err", err)
			httpx.JSON(w, 401, map[string]string{"error": "bad signature"})
			return
		}
		switch e.Type {
		case "SubscriptionConfirmation":
			if !AWSURL(e.SubscribeURL) {
				httpx.JSON(w, 400, map[string]string{"error": "subscribe url is not on SNS"})
				return
			}
			req, _ := http.NewRequestWithContext(r.Context(), "GET", e.SubscribeURL, nil)
			res, err := v.HTTP.Do(req)
			if err != nil {
				slog.Error("confirm SNS subscription", "err", err)
				httpx.JSON(w, 502, map[string]string{"error": "could not confirm"})
				return
			}
			res.Body.Close()
			slog.Info("SNS subscription confirmed", "topic", e.TopicArn)
			httpx.JSON(w, 200, map[string]bool{"confirmed": true})
		case "Notification":
			if err := s.Record(r.Context(), e.MessageId, json.RawMessage(e.Message)); err != nil {
				// A 500 makes SNS retry; the MessageId dedupe makes that safe.
				slog.Error("record SES event", "err", err)
				httpx.JSON(w, 500, map[string]string{"error": "could not record"})
				return
			}
			httpx.JSON(w, 200, map[string]bool{"ok": true})
		default:
			httpx.JSON(w, 200, map[string]bool{"ignored": true})
		}
	})
}

// Routes is the dashboard API, mounted at /api/app.
func Routes(s *Service) http.Handler {
	r := chi.NewRouter()
	h := func(method, path string, fn func(context.Context, *http.Request) (int, any, error)) {
		r.Method(method, path, httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
			status, v, err := fn(r.Context(), r)
			if err != nil {
				return err
			}
			httpx.JSON(w, status, v)
			return nil
		}))
	}
	h("GET", "/suppressions", func(ctx context.Context, r *http.Request) (int, any, error) {
		p, err := page.Parse(r.URL.Query())
		if err != nil {
			return 0, nil, err
		}
		list, err := s.ListSuppressions(ctx, r.URL.Query().Get("q"), p)
		return 200, list, err
	})
	h("POST", "/suppressions", func(ctx context.Context, r *http.Request) (int, any, error) {
		var in struct {
			Address string `json:"address" validate:"required"`
			Reason  string `json:"reason" validate:"max=200"`
		}
		if err := httpx.Bind(r, &in); err != nil {
			return 0, nil, err
		}
		x, err := s.Suppress(ctx, in.Address, in.Reason)
		return 201, x, err
	})
	h("DELETE", "/suppressions/{id}", func(ctx context.Context, r *http.Request) (int, any, error) {
		x, err := s.Unsuppress(ctx, chi.URLParam(r, "id"))
		if err != nil {
			return 0, nil, err
		}
		return 200, map[string]any{"object": "suppression", "id": x.ID, "address": x.Address, "deleted": true}, nil
	})
	h("GET", "/logs", func(ctx context.Context, r *http.Request) (int, any, error) {
		q := r.URL.Query()
		p, err := page.Parse(q)
		if err != nil {
			return 0, nil, err
		}
		days, _ := strconv.Atoi(q.Get("days"))
		list, err := s.Log(ctx, LogFilter{Outbound: q.Get("direction") != "receiving", Query: q.Get("q"),
			Status: q.Get("status"), Days: days, APIKeyID: q.Get("api_key_id"), Page: p})
		return 200, list, err
	})
	h("GET", "/metrics", func(ctx context.Context, r *http.Request) (int, any, error) {
		days, _ := strconv.Atoi(r.URL.Query().Get("range"))
		m, err := s.Metrics(ctx, days, r.URL.Query().Get("domain_id"))
		return 200, m, err
	})
	h("GET", "/overview", func(ctx context.Context, r *http.Request) (int, any, error) {
		o, err := s.GetOverview(ctx)
		return 200, o, err
	})
	return r
}
