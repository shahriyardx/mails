package reporting

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/shahriyardx/mails/internal/httpx"
)

// Routes is the dashboard API, mounted at /api/app/reporting.
func Routes(s *Service) http.Handler {
	r := chi.NewRouter()
	reply := func(w http.ResponseWriter, st *Status, err error) error {
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, st)
		return nil
	}
	r.Method("GET", "/", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		st, err := s.Status(r.Context())
		return reply(w, st, err)
	}))
	r.Method("POST", "/setup", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		st, err := s.SetUp(r.Context())
		return reply(w, st, err)
	}))
	r.Method("PUT", "/events", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			Types []string `json:"types"`
		}
		if err := httpx.Decode(r, &in); err != nil {
			return err
		}
		st, err := s.SetEventTypes(r.Context(), in.Types)
		return reply(w, st, err)
	}))
	return r
}
