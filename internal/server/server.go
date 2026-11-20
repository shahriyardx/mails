// Package server wires every route into one http.Handler.
//
// Route layout:
//
//	/api/auth/*    sign-in (public)
//	/api/health    liveness (public)
//	/api/inbound   the Cloudflare worker posts mail here (shared secret)
//	/api/ses/*     SNS posts delivery events here (SNS signature)
//	/api/app/*     the dashboard's own JSON API (owner session)
//	/api/events    SSE live updates (owner session)
//	/api/v1/*      public API (API key, or owner session)
//	everything else: the embedded React app (index.html fallback)
package server

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/auth"
	"github.com/shahriyardx/mails/internal/config"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/realtime"
)

// Deps is everything a feature package may need. Feature packages take what
// they use from here in their own Routes/Register function.
type Deps struct {
	DB   *pgxpool.Pool
	Cfg  *config.Config
	Auth *auth.Auth
	Hub  *realtime.Hub
}

// New builds the router. web is the built React app (web/dist).
func New(d *Deps, web fs.FS) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RealIP, middleware.Recoverer, securityHeaders)

	r.Route("/api", func(api chi.Router) {
		api.Get("/health", func(w http.ResponseWriter, r *http.Request) {
			httpx.JSON(w, 200, map[string]string{"status": "ok"})
		})

		// Machine callers: no session cookie involved.
		// api.Post("/inbound", ...)      inbound.Handler
		// api.Post("/ses/events", ...)   delivery.SNSHandler

		// Everything that reads or writes the session cookie.
		api.Group(func(s chi.Router) {
			s.Use(d.Auth.Sessions.LoadAndSave)
			s.Mount("/auth", d.Auth.Routes())

			s.Group(func(owner chi.Router) {
				owner.Use(d.Auth.Require)
				owner.Get("/events", d.Hub.ServeHTTP)
				owner.Route("/app", func(app chi.Router) {
					app.Method("GET", "/me", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
						httpx.JSON(w, 200, auth.FromContext(r.Context()))
						return nil
					}))
					// Feature packages mount here, e.g. app.Mount("/threads", mail.Routes(d)).
				})
			})
			// api.Mount("/v1", apiv1.Routes(d))  API key or owner session
		})

		api.NotFound(func(w http.ResponseWriter, r *http.Request) {
			httpx.Fail(w, r, httpx.NotFound("No such endpoint"))
		})
	})

	r.Handle("/*", spa(web))
	return r
}

// spa serves built files, and index.html for any path that is not a file, so
// client-side routes like /mail/inbox load the app.
func spa(web fs.FS) http.Handler {
	files := http.FileServerFS(web)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path != "" {
			if _, err := fs.Stat(web, path); err == nil {
				if strings.HasPrefix(path, "assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFileFS(w, r, web, "index.html")
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("X-Frame-Options", "DENY")
		next.ServeHTTP(w, r)
	})
}
