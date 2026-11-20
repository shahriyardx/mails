package domain

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/shahriyardx/mails/internal/httpx"
)

// Routes is the dashboard API, mounted at /api/app/domains.
func Routes(s *Service) http.Handler {
	r := chi.NewRouter()
	r.Method("GET", "/", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		// ?light=true skips the SES refresh, for pickers that need names only.
		var list []*Domain
		var warning string
		var err error
		if r.URL.Query().Get("light") == "true" {
			list, err = s.List(r.Context())
		} else {
			list, warning, err = s.ListFresh(r.Context())
		}
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, map[string]any{"data": list, "warning": warning})
		return nil
	}))
	r.Method("POST", "/", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			Name string `json:"name" validate:"required"`
		}
		if err := httpx.Bind(r, &in); err != nil {
			return err
		}
		d, err := s.Add(r.Context(), in.Name)
		if err != nil {
			return err
		}
		httpx.JSON(w, 201, d)
		return nil
	}))
	r.Method("POST", "/import", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		res, err := s.Import(r.Context())
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, res)
		return nil
	}))
	r.Method("GET", "/{id}", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		d, err := s.Get(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, d)
		return nil
	}))
	r.Method("PATCH", "/{id}", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			AutoCreate *bool `json:"auto_create_mailboxes"`
			ForwardOff *bool `json:"forward_off"`
		}
		if err := httpx.Bind(r, &in); err != nil {
			return err
		}
		d, err := s.Settings(r.Context(), chi.URLParam(r, "id"), in.AutoCreate, in.ForwardOff)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, d)
		return nil
	}))
	r.Method("POST", "/{id}/verify", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		d, err := s.Refresh(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, d)
		return nil
	}))
	r.Method("POST", "/{id}/own-dkim", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		d, err := s.UseOwnDKIMKey(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, d)
		return nil
	}))
	r.Method("DELETE", "/{id}", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		d, inSES, err := s.Remove(r.Context(), chi.URLParam(r, "id"), r.URL.Query().Get("delete_in_ses") == "true")
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, map[string]any{"object": "domain", "id": d.ID, "name": d.Name, "deleted": true, "deleted_in_ses": inSES})
		return nil
	}))
	return r
}
