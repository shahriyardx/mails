// Package auth is GitHub sign-in for the single owner, plus browser sessions.
//
// The first GitHub account to finish sign-in becomes the owner. Every other
// account is refused until the owner row is deleted. There is no sign-up, no
// password and no account linking; the owner is matched by GitHub's numeric
// user id, never by email.
package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/alexedwards/scs/pgxstore"
	"github.com/alexedwards/scs/v2"
	"github.com/go-chi/chi/v5"
	"github.com/google/go-github/v93/github"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"
	oauthgithub "golang.org/x/oauth2/github"

	"github.com/shahriyardx/mails/internal/config"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/id"
)

const (
	userKey  = "user_id"
	stateKey = "oauth_state"
)

// ErrTaken is returned when a GitHub account other than the owner signs in.
var ErrTaken = errors.New("this instance already has an owner")

// Owner is the signed-in person, put on the request context by Require.
type Owner struct {
	ID        string `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url,omitempty"`
}

// GitHubUser is what sign-in needs from GitHub.
type GitHubUser struct {
	ID        int64
	Login     string
	Name      string
	Email     string
	AvatarURL string
}

type Auth struct {
	DB       *pgxpool.Pool
	Sessions *scs.SessionManager
	OAuth    *oauth2.Config
}

func New(pool *pgxpool.Pool, cfg *config.Config) *Auth {
	sm := scs.New()
	sm.Store = pgxstore.New(pool)
	sm.Lifetime = 30 * 24 * time.Hour
	sm.IdleTimeout = 14 * 24 * time.Hour
	sm.Cookie.Name = "mails_session"
	sm.Cookie.HttpOnly = true
	sm.Cookie.SameSite = http.SameSiteLaxMode
	sm.Cookie.Secure = cfg.Secure()

	return &Auth{
		DB:       pool,
		Sessions: sm,
		OAuth: &oauth2.Config{
			ClientID:     cfg.GitHubClientID,
			ClientSecret: cfg.GitHubClientSecret,
			Endpoint:     oauthgithub.Endpoint,
			RedirectURL:  cfg.AppURL + "/api/auth/callback/github",
			Scopes:       []string{"read:user", "user:email"},
		},
	}
}

// Routes returns the public sign-in routes, mounted at /api/auth.
func (a *Auth) Routes() http.Handler {
	r := chi.NewRouter()
	r.Get("/github", a.start)
	r.Get("/callback/github", a.callback)
	r.Method("POST", "/sign-out", httpx.Handler(a.signOut))
	r.Method("GET", "/status", httpx.Handler(a.status))
	return r
}

func (a *Auth) start(w http.ResponseWriter, r *http.Request) {
	state := id.Token(16)
	a.Sessions.Put(r.Context(), stateKey, state)
	http.Redirect(w, r, a.OAuth.AuthCodeURL(state), http.StatusFound)
}

func (a *Auth) callback(w http.ResponseWriter, r *http.Request) {
	fail := func(reason string) {
		http.Redirect(w, r, "/sign-in?error="+reason, http.StatusFound)
	}
	ctx := r.Context()
	want := a.Sessions.PopString(ctx, stateKey)
	if want == "" || want != r.URL.Query().Get("state") {
		fail("state")
		return
	}
	tok, err := a.OAuth.Exchange(ctx, r.URL.Query().Get("code"))
	if err != nil {
		fail("github")
		return
	}
	client, err := github.NewClient(github.WithHTTPClient(a.OAuth.Client(ctx, tok)))
	if err != nil {
		fail("github")
		return
	}
	gh, err := fetchUser(ctx, client)
	if err != nil {
		fail("github")
		return
	}
	userID, err := Claim(ctx, a.DB, gh)
	if errors.Is(err, ErrTaken) {
		fail("taken")
		return
	}
	if err != nil {
		fail("server")
		return
	}
	// New token on privilege change, so a pre-login session id is never reused.
	if err := a.Sessions.RenewToken(ctx); err != nil {
		fail("server")
		return
	}
	a.Sessions.Put(ctx, userKey, userID)
	http.Redirect(w, r, "/", http.StatusFound)
}

// Claim signs gh in. With no owner yet, gh becomes the owner. With an owner,
// only the same GitHub account (by numeric id) gets in. An advisory lock makes
// two simultaneous first sign-ins safe: exactly one wins.
func Claim(ctx context.Context, pool *pgxpool.Pool, gh GitHubUser) (string, error) {
	var userID string
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(4207001)`); err != nil {
			return err
		}
		var ownerID string
		var ownerGitHub int64
		err := tx.QueryRow(ctx, `SELECT id, github_id FROM app_user LIMIT 1`).Scan(&ownerID, &ownerGitHub)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			userID = id.New("usr")
			_, err = tx.Exec(ctx,
				`INSERT INTO app_user (id, github_id, login, name, email, avatar_url) VALUES ($1, $2, $3, $4, $5, $6)`,
				userID, gh.ID, gh.Login, nonEmpty(gh.Name, gh.Login), gh.Email, gh.AvatarURL)
			return err
		case err != nil:
			return err
		case ownerGitHub != gh.ID:
			return ErrTaken
		default:
			userID = ownerID
			_, err = tx.Exec(ctx,
				`UPDATE app_user SET login = $2, name = $3, email = $4, avatar_url = $5 WHERE id = $1`,
				ownerID, gh.Login, nonEmpty(gh.Name, gh.Login), gh.Email, gh.AvatarURL)
			return err
		}
	})
	return userID, err
}

func fetchUser(ctx context.Context, client *github.Client) (GitHubUser, error) {
	u, _, err := client.Users.Get(ctx, "")
	if err != nil {
		return GitHubUser{}, err
	}
	if u.GetID() == 0 {
		return GitHubUser{}, errors.New("github returned no user id")
	}
	gh := GitHubUser{ID: u.GetID(), Login: u.GetLogin(), Name: u.GetName(), Email: u.GetEmail(), AvatarURL: u.GetAvatarURL()}
	if gh.Email == "" {
		emails, _, err := client.Users.ListEmails(ctx, nil)
		if err == nil {
			for _, e := range emails {
				if e.GetPrimary() && e.GetVerified() {
					gh.Email = e.GetEmail()
				}
			}
		}
	}
	return gh, nil
}

func (a *Auth) signOut(w http.ResponseWriter, r *http.Request) error {
	if err := a.Sessions.Destroy(r.Context()); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// status tells the sign-in page whether anyone is signed in and whether the
// instance has been claimed.
func (a *Auth) status(w http.ResponseWriter, r *http.Request) error {
	owner, err := a.lookup(r.Context())
	if err != nil {
		return err
	}
	var claimed bool
	if err := a.DB.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM app_user)`).Scan(&claimed); err != nil {
		return err
	}
	httpx.JSON(w, 200, map[string]any{"owner": owner, "claimed": claimed})
	return nil
}

type ctxKey struct{}

// FromContext returns the owner Require put on the context.
func FromContext(ctx context.Context) *Owner {
	o, _ := ctx.Value(ctxKey{}).(*Owner)
	return o
}

// WithOwner puts o on ctx. Used by Require, and by tests.
func WithOwner(ctx context.Context, o *Owner) context.Context {
	return context.WithValue(ctx, ctxKey{}, o)
}

// Require lets a request through only with a valid owner session. A request
// that changes state must also come from this site (Sec-Fetch-Site), on top of
// the SameSite=Lax cookie. Must sit inside Sessions.LoadAndSave.
func (a *Auth) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		owner, err := a.lookup(r.Context())
		if err != nil {
			httpx.Fail(w, r, err)
			return
		}
		if owner == nil {
			httpx.Fail(w, r, httpx.Unauthorized("Sign in first"))
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
				httpx.Fail(w, r, httpx.Forbidden("Cross-site request refused"))
				return
			}
		}
		next.ServeHTTP(w, r.WithContext(WithOwner(r.Context(), owner)))
	})
}

// lookup returns the owner for the current session, or nil.
func (a *Auth) lookup(ctx context.Context) (*Owner, error) {
	userID := a.Sessions.GetString(ctx, userKey)
	if userID == "" {
		return nil, nil
	}
	var o Owner
	var avatar *string
	err := a.DB.QueryRow(ctx, `SELECT id, login, name, email, avatar_url FROM app_user WHERE id = $1`, userID).
		Scan(&o.ID, &o.Login, &o.Name, &o.Email, &avatar)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil // owner was reset; the old session is dead
	}
	if err != nil {
		return nil, err
	}
	if avatar != nil {
		o.AvatarURL = *avatar
	}
	return &o, nil
}

func nonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}
