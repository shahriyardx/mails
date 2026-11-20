// Package setup is the first-run wizard: what is done, what is left, and
// the instance settings it writes (brand name, finished).
package setup

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/httpx"
)

// Service reads and writes the settings row.
type Service struct {
	DB *pgxpool.Pool
	// SESConfigured reports whether AWS keys (or a role) are set up.
	SESConfigured bool
	Region        string
}

// Step is one wizard item.
type Step struct {
	Key    string `json:"key"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
	Href   string `json:"href,omitempty"`
	Done   bool   `json:"done"`
}

// State is the wizard page.
type State struct {
	Completed   bool       `json:"completed"`
	CompletedAt *time.Time `json:"completed_at"`
	BrandName   *string    `json:"brand_name"`
	Steps       []Step     `json:"steps"`
	Remaining   int        `json:"remaining"`
}

func (s *Service) State(ctx context.Context) (*State, error) {
	st := &State{}
	var domains, verified, mailboxes int
	var cloudflare bool
	err := s.DB.QueryRow(ctx, `SELECT st.setup_completed_at, st.brand_name,
		(SELECT count(*) FROM domain), (SELECT count(*) FROM domain WHERE status = 'verified' AND sending_enabled),
		(SELECT count(*) FROM mailbox), EXISTS (SELECT 1 FROM integration WHERE provider = 'cloudflare')
		FROM settings st WHERE id = 1`).Scan(&st.CompletedAt, &st.BrandName, &domains, &verified, &mailboxes, &cloudflare)
	if err != nil {
		return nil, fmt.Errorf("setup state: %w", err)
	}
	st.Completed = st.CompletedAt != nil
	sesDetail := "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, then restart."
	if s.SESConfigured {
		sesDetail = "Keys found, region " + s.Region + "."
	}
	domainDetail := "The domain your mail is sent from."
	switch {
	case verified > 0:
		domainDetail = fmt.Sprintf("%d verified.", verified)
	case domains > 0:
		domainDetail = "Added. Publish its DNS records, then re-check."
	}
	st.Steps = []Step{
		{Key: "ses", Title: "Connect Amazon SES", Detail: sesDetail, Href: "/docs/guide/self-hosting", Done: s.SESConfigured},
		{Key: "domain", Title: "Add a domain", Detail: domainDetail, Href: "/settings/domains", Done: verified > 0},
		{Key: "mailbox", Title: "Create a mailbox", Detail: "An address to send from and receive at.", Href: "/settings/mailboxes", Done: mailboxes > 0},
		{Key: "inbound", Title: "Receive mail", Detail: "Connect Cloudflare and deploy the inbound worker.", Href: "/settings/inbound", Done: cloudflare},
	}
	for _, step := range st.Steps {
		if !step.Done {
			st.Remaining++
		}
	}
	return st, nil
}

// Update sets the brand name (empty clears it) and, when finish is set,
// marks the wizard done so it no longer shows.
func (s *Service) Update(ctx context.Context, brand *string, finish bool) (*State, error) {
	if brand != nil {
		v := strings.TrimSpace(*brand)
		if len(v) > 60 {
			return nil, httpx.Invalid("brand_name", "brand_name: At most 60 characters")
		}
		brand = &v
	}
	_, err := s.DB.Exec(ctx, `UPDATE settings SET brand_name = CASE WHEN $1::boolean THEN nullif($2, '') ELSE brand_name END,
		setup_completed_at = CASE WHEN $3 THEN coalesce(setup_completed_at, now()) ELSE setup_completed_at END,
		updated_at = now() WHERE id = 1`, brand != nil, deref(brand), finish)
	if err != nil {
		return nil, fmt.Errorf("update settings: %w", err)
	}
	return s.State(ctx)
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// Routes is the dashboard API, mounted at /api/app/setup.
func Routes(s *Service) http.Handler {
	mux := chi.NewRouter()
	mux.Method("GET", "/", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		st, err := s.State(r.Context())
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, st)
		return nil
	}))
	mux.Method("PATCH", "/", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			BrandName *string `json:"brand_name"`
			Completed bool    `json:"completed"`
		}
		if err := httpx.Decode(r, &in); err != nil {
			return err
		}
		st, err := s.Update(r.Context(), in.BrandName, in.Completed)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, st)
		return nil
	}))
	return mux
}
