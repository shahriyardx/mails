package cloudflare

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/shahriyardx/mails/internal/httpx"
)

// Routes is the dashboard API for the inbound worker, mounted at
// /api/app/inbound.
func Routes(s *Service) http.Handler {
	r := chi.NewRouter()
	status := func(w http.ResponseWriter, r *http.Request) error {
		st, err := s.Status(r.Context())
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, st)
		return nil
	}
	r.Method("GET", "/", httpx.Handler(status))
	r.Method("POST", "/connect", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			Token string `json:"token" validate:"required"`
		}
		if err := httpx.Bind(r, &in); err != nil {
			return err
		}
		st, err := s.Connect(r.Context(), in.Token)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, st)
		return nil
	}))
	r.Method("DELETE", "/connect", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		if err := s.Disconnect(r.Context()); err != nil {
			return err
		}
		return status(w, r)
	}))
	r.Method("POST", "/deploy", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		if err := s.Deploy(r.Context()); err != nil {
			return err
		}
		return status(w, r)
	}))
	r.Method("DELETE", "/worker", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		if err := s.RemoveWorker(r.Context()); err != nil {
			return err
		}
		return status(w, r)
	}))
	r.Method("POST", "/zones/{id}/route", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		if err := s.RouteZone(r.Context(), chi.URLParam(r, "id")); err != nil {
			return err
		}
		return status(w, r)
	}))
	r.Method("POST", "/zones/{id}/unroute", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		if err := s.UnrouteZone(r.Context(), chi.URLParam(r, "id"), r.URL.Query().Get("disable_routing") == "true"); err != nil {
			return err
		}
		return status(w, r)
	}))
	return r
}
