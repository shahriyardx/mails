package webhook

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/page"
)

// Routes is the dashboard API for webhooks, mounted at /api/app/webhooks.
// The owner sees every endpoint.
func Routes(s *Service) http.Handler {
	r := chi.NewRouter()
	h := func(method, path string, fn func(w http.ResponseWriter, r *http.Request) (int, any, error)) {
		r.Method(method, path, httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
			status, v, err := fn(w, r)
			if err != nil {
				return err
			}
			httpx.JSON(w, status, v)
			return nil
		}))
	}
	h("GET", "/", func(w http.ResponseWriter, r *http.Request) (int, any, error) {
		list, err := s.List(r.Context(), nil)
		return 200, map[string]any{"data": nonNilHooks(list), "events": Events}, err
	})
	h("POST", "/", func(w http.ResponseWriter, r *http.Request) (int, any, error) {
		var in Input
		if err := httpx.Decode(r, &in); err != nil {
			return 0, nil, err
		}
		wh, err := s.Create(r.Context(), in)
		return 201, wh, err
	})
	h("PATCH", "/{id}", func(w http.ResponseWriter, r *http.Request) (int, any, error) {
		var p Patch
		if err := httpx.Decode(r, &p); err != nil {
			return 0, nil, err
		}
		wh, err := s.Update(r.Context(), nil, chi.URLParam(r, "id"), p)
		return 200, wh, err
	})
	h("DELETE", "/{id}", func(w http.ResponseWriter, r *http.Request) (int, any, error) {
		err := s.Delete(r.Context(), nil, chi.URLParam(r, "id"), r.URL.Query().Get("disable_only") == "true")
		return 200, map[string]bool{"deleted": true}, err
	})
	h("POST", "/{id}/ping", func(w http.ResponseWriter, r *http.Request) (int, any, error) {
		res, err := s.Ping(r.Context(), nil, chi.URLParam(r, "id"))
		return 200, res, err
	})
	h("GET", "/deliveries", func(w http.ResponseWriter, r *http.Request) (int, any, error) {
		q := r.URL.Query()
		p, err := page.Parse(q)
		if err != nil {
			return 0, nil, err
		}
		f := DeliveryFilter{WebhookID: q.Get("webhook_id"), Event: q.Get("event"), Page: p}
		if v := q.Get("succeeded"); v != "" {
			b := v == "true"
			f.Succeeded = &b
		}
		list, err := s.Deliveries(r.Context(), f)
		return 200, list, err
	})
	h("POST", "/deliveries/{id}/replay", func(w http.ResponseWriter, r *http.Request) (int, any, error) {
		res, err := s.Replay(r.Context(), nil, chi.URLParam(r, "id"))
		return 200, res, err
	})
	return r
}

func nonNilHooks(l []*Webhook) []*Webhook {
	if l == nil {
		return []*Webhook{}
	}
	return l
}
