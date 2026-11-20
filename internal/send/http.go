package send

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/shahriyardx/mails/internal/httpx"
)

// Routes is the dashboard API for writing mail, mounted at /api/app.
func Routes(s *Service) http.Handler {
	r := chi.NewRouter()
	r.Method("POST", "/send", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var in Input
		if err := httpx.Decode(r, &in); err != nil {
			return err
		}
		res, err := s.Send(r.Context(), in)
		if err != nil {
			return err
		}
		httpx.JSON(w, 202, res)
		return nil
	}))
	r.Method("POST", "/drafts", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var in Input
		if err := httpx.Decode(r, &in); err != nil {
			return err
		}
		res, err := s.SaveDraft(r.Context(), in)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, res)
		return nil
	}))
	r.Method("DELETE", "/drafts/{id}", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		if err := s.DeleteDraft(r.Context(), nil, chi.URLParam(r, "id")); err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}))
	r.Method("POST", "/threads/{id}/reply", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var in ReplyInput
		if err := httpx.Bind(r, &in); err != nil {
			return err
		}
		res, err := s.Reply(r.Context(), chi.URLParam(r, "id"), in)
		if err != nil {
			return err
		}
		httpx.JSON(w, 202, res)
		return nil
	}))
	r.Method("POST", "/emails/{id}/cancel", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		if err := s.Cancel(r.Context(), nil, chi.URLParam(r, "id")); err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}))
	return r
}
