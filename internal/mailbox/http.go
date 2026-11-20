package mailbox

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/shahriyardx/mails/internal/httpx"
)

// Routes is the dashboard API, mounted at /api/app/mailboxes.
func Routes(s *Service) http.Handler {
	r := chi.NewRouter()
	r.Method("GET", "/", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		list, err := s.List(r.Context(), r.URL.Query().Get("domain"))
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, map[string]any{"data": list})
		return nil
	}))
	r.Method("POST", "/", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var in Input
		if err := httpx.Decode(r, &in); err != nil {
			return err
		}
		m, err := s.Create(r.Context(), in)
		if err != nil {
			return err
		}
		httpx.JSON(w, 201, m)
		return nil
	}))
	r.Method("GET", "/{id}", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		m, err := s.Get(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, m)
		return nil
	}))
	r.Method("PATCH", "/{id}", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var p Patch
		if err := httpx.Decode(r, &p); err != nil {
			return err
		}
		m, err := s.Update(r.Context(), chi.URLParam(r, "id"), p)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, m)
		return nil
	}))
	r.Method("DELETE", "/{id}", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		m, err := s.Delete(r.Context(), chi.URLParam(r, "id"), r.URL.Query().Get("confirm") == "true")
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, map[string]any{"object": "mailbox", "id": m.ID, "deleted": true})
		return nil
	}))
	return r
}
