package apikey

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/shahriyardx/mails/internal/httpx"
)

// Routes is the dashboard API for keys, mounted at /api/app/api-keys.
func Routes(s *Service) http.Handler {
	r := chi.NewRouter()
	r.Method("GET", "/", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		list, err := s.List(r.Context())
		if err != nil {
			return err
		}
		if list == nil {
			list = []*Key{}
		}
		httpx.JSON(w, 200, map[string]any{"data": list, "scopes": Scopes, "presets": Presets, "areas": Areas})
		return nil
	}))
	r.Method("POST", "/", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var in Input
		if err := httpx.Decode(r, &in); err != nil {
			return err
		}
		k, token, err := s.Create(r.Context(), in)
		if err != nil {
			return err
		}
		httpx.JSON(w, 201, map[string]any{"key": k, "token": token})
		return nil
	}))
	r.Method("PATCH", "/{id}", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			Name string `json:"name"`
		}
		if err := httpx.Decode(r, &in); err != nil {
			return err
		}
		k, err := s.Rename(r.Context(), chi.URLParam(r, "id"), in.Name)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, k)
		return nil
	}))
	r.Method("DELETE", "/{id}", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		do := s.Revoke
		if r.URL.Query().Get("purge") == "true" {
			do = s.Purge
		}
		if err := do(r.Context(), chi.URLParam(r, "id")); err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}))
	return r
}
