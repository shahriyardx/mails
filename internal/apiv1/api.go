// Package apiv1 is the public REST API at /api/v1, authenticated with API
// keys. Handlers check the key's scope and reach, then call the same
// service functions the dashboard uses. Shapes follow web/src/docs/api.
package apiv1

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/apikey"
	"github.com/shahriyardx/mails/internal/delivery"
	"github.com/shahriyardx/mails/internal/domain"
	"github.com/shahriyardx/mails/internal/events"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/idempotency"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/mailbox"
	"github.com/shahriyardx/mails/internal/send"
	"github.com/shahriyardx/mails/internal/webhook"
)

// API holds every service the public API calls.
type API struct {
	DB        *pgxpool.Pool
	Keys      *apikey.Service
	Domains   *domain.Service
	Mailboxes *mailbox.Service
	Mail      *mail.Service
	Send      *send.Service
	Delivery  *delivery.Service
	Webhooks  *webhook.Service
	Idem      *idempotency.Store
	Events    events.Sink
	BaseURL   string // APP_URL + /api/v1

	limiters sync.Map // rate limit per minute -> *httprate.RateLimiter
}

// caller is the authenticated key for one request.
type caller struct {
	key     *apikey.Key
	once    sync.Once
	allowed []string
	err     error
}

type ctxKey struct{}

func from(r *http.Request) *caller { return r.Context().Value(ctxKey{}).(*caller) }

// reach returns the mailbox ids the key may touch, or nil for all.
func (a *API) reach(ctx context.Context, c *caller) ([]string, error) {
	c.once.Do(func() { c.allowed, c.err = apikey.Allowed(ctx, a.DB, c.key.Reach) })
	return c.allowed, c.err
}

func (a *API) limiter(perMinute int) *httprate.RateLimiter {
	if l, ok := a.limiters.Load(perMinute); ok {
		return l.(*httprate.RateLimiter)
	}
	l, _ := a.limiters.LoadOrStore(perMinute, httprate.NewRateLimiter(perMinute, time.Minute,
		httprate.WithLimitHandler(func(w http.ResponseWriter, r *http.Request) {
			httpx.Fail(w, r, httpx.RateLimited("Too many requests. Slow down."))
		})))
	return l.(*httprate.RateLimiter)
}

// authenticate checks the bearer key, then its rate limit.
func (a *API) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok {
			httpx.Fail(w, r, httpx.Unauthorized("Invalid or missing API key"))
			return
		}
		key, err := a.Keys.Authenticate(r.Context(), strings.TrimSpace(token))
		if err != nil {
			httpx.Fail(w, r, err)
			return
		}
		if key == nil {
			httpx.Fail(w, r, httpx.Unauthorized("Invalid or missing API key"))
			return
		}
		if a.limiter(key.RateLimit).RespondOnLimit(w, r, key.ID) {
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, &caller{key: key})))
	})
}

// handler is a v1 handler: it returns the status and body, or an error.
type handler func(w http.ResponseWriter, r *http.Request, c *caller) (int, any, error)

// h wraps fn with a scope check. scope "" needs none.
func (a *API) h(scope string, fn handler) http.Handler {
	return httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		c := from(r)
		if scope != "" && !apikey.Has(c.key.Scopes, scope) {
			return &httpx.Error{Status: 403, Code: "forbidden", Message: `This API key does not have the "` + scope + `" scope`,
				Extra: map[string]any{"required_scope": scope, "scopes": c.key.Scopes}}
		}
		status, v, err := fn(w, r, c)
		if err != nil || status == 0 {
			return err
		}
		if raw, ok := v.(json.RawMessage); ok {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_, _ = w.Write(raw)
			return nil
		}
		httpx.JSON(w, status, v)
		return nil
	})
}

// unrestricted refuses keys that reach only part of the account, for calls
// that change or reveal the whole account.
func unrestricted(c *caller, what string) error {
	if c.key.Reach.Unrestricted() {
		return nil
	}
	return httpx.Forbidden("Only a key that reaches the whole account may " + what)
}

// idempotent runs fn under the request's Idempotency-Key, if it has one.
func (a *API) idempotent(w http.ResponseWriter, r *http.Request, c *caller, body []byte, fn func() (int, any, error)) (int, any, error) {
	key := r.Header.Get("Idempotency-Key")
	if key == "" {
		return fn()
	}
	reply, err := a.Idem.Do(r.Context(), c.key.ID, key, r.URL.Path, body, fn)
	if err != nil {
		return 0, nil, err
	}
	if reply.Replayed {
		w.Header().Set("Idempotency-Replayed", "true")
	}
	return reply.Status, reply.Body, nil
}

// readBody reads a JSON body (bounded) so it can be hashed and decoded.
func readBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 32<<20))
	if err != nil {
		return nil, &httpx.Error{Status: 413, Code: "payload_too_large", Message: "The request body is too large"}
	}
	return b, nil
}

// decodeStrict decodes b into v, refusing unknown fields (template,
// scheduled_at and anything else this API does not take).
func decodeStrict(b []byte, v any) error {
	dec := json.NewDecoder(strings.NewReader(string(b)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return httpx.Invalid("", "Request body is not valid JSON for this endpoint: "+err.Error())
	}
	return nil
}

func boolQuery(r *http.Request, name string) bool { return r.URL.Query().Get(name) == "true" }

func atoiDefault(s string, d int) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return d
}

// Routes builds the /api/v1 router.
func (a *API) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(a.authenticate)

	r.Method("GET", "/me", a.h("", a.me))

	r.Method("POST", "/emails", a.h("emails:send", a.sendEmail))
	r.Method("POST", "/emails/batch", a.h("emails:send", a.sendBatch))
	r.Method("GET", "/emails", a.h("emails:read", a.listEmails))
	r.Method("GET", "/emails/{id}", a.h("emails:read", a.getEmail))
	r.Method("POST", "/emails/{id}/cancel", a.h("emails:send", a.cancelEmail))

	r.Method("GET", "/threads", a.h("mail:read", a.listThreads))
	r.Method("GET", "/threads/{id}", a.h("mail:read", a.getThread))
	r.Method("PATCH", "/threads/{id}", a.h("mail:write", a.patchThread))
	r.Method("POST", "/threads/{id}/reply", a.h("mail:write", a.replyThread))
	r.Method("DELETE", "/threads/{id}", a.h("mail:write", a.deleteThread))

	r.Method("GET", "/messages", a.h("mail:read", a.listMessages))
	r.Method("GET", "/messages/{id}", a.h("mail:read", a.getMessage))
	r.Method("PATCH", "/messages/{id}", a.h("mail:write", a.patchMessage))
	r.Method("GET", "/messages/{id}/raw", a.h("mail:read", a.rawMessage))
	r.Method("GET", "/attachments/{id}", a.h("mail:read", a.getAttachment))

	r.Method("GET", "/mailboxes", a.h("mailboxes:read", a.listMailboxes))
	r.Method("GET", "/mailboxes/{id}", a.h("mailboxes:read", a.getMailbox))
	r.Method("POST", "/mailboxes", a.h("mailboxes:write", a.createMailbox))
	r.Method("PATCH", "/mailboxes/{id}", a.h("mailboxes:write", a.patchMailbox))
	r.Method("DELETE", "/mailboxes/{id}", a.h("mailboxes:write", a.deleteMailbox))

	r.Method("GET", "/domains", a.h("domains:read", a.listDomains))
	r.Method("GET", "/domains/{id}", a.h("domains:read", a.getDomain))
	r.Method("POST", "/domains", a.h("domains:write", a.addDomain))
	r.Method("POST", "/domains/{id}/verify", a.h("domains:write", a.verifyDomain))
	r.Method("DELETE", "/domains/{id}", a.h("domains:write", a.deleteDomain))

	r.Method("GET", "/labels", a.h("labels:read", a.listLabels))
	r.Method("GET", "/labels/{id}", a.h("labels:read", a.getLabel))
	r.Method("POST", "/labels", a.h("labels:write", a.createLabel))
	r.Method("PATCH", "/labels/{id}", a.h("labels:write", a.patchLabel))
	r.Method("DELETE", "/labels/{id}", a.h("labels:write", a.deleteLabel))

	r.Method("GET", "/contacts", a.h("contacts:read", a.listContacts))

	r.Method("GET", "/suppressions", a.h("suppressions:read", a.listSuppressions))
	r.Method("POST", "/suppressions", a.h("suppressions:write", a.addSuppression))
	r.Method("DELETE", "/suppressions/{id}", a.h("suppressions:write", a.deleteSuppression))

	r.Method("GET", "/webhooks", a.h("webhooks:read", a.listWebhooks))
	r.Method("GET", "/webhooks/{id}", a.h("webhooks:read", a.getWebhook))
	r.Method("POST", "/webhooks", a.h("webhooks:write", a.createWebhook))
	r.Method("PATCH", "/webhooks/{id}", a.h("webhooks:write", a.patchWebhook))
	r.Method("DELETE", "/webhooks/{id}", a.h("webhooks:write", a.deleteWebhook))
	r.Method("POST", "/webhooks/{id}/ping", a.h("webhooks:write", a.pingWebhook))
	r.Method("GET", "/webhook-deliveries", a.h("webhooks:read", a.listDeliveries))
	r.Method("POST", "/webhook-deliveries/{id}/replay", a.h("webhooks:write", a.replayDelivery))

	r.Method("GET", "/stats", a.h("stats:read", a.stats))

	r.NotFound(func(w http.ResponseWriter, r *http.Request) { httpx.Fail(w, r, httpx.NotFound("No such endpoint")) })
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		httpx.Fail(w, r, &httpx.Error{Status: 405, Code: "method_not_allowed", Message: "This endpoint does not take " + r.Method})
	})
	return r
}

func (a *API) me(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	allowed, err := a.reach(r.Context(), c)
	if err != nil {
		return 0, nil, err
	}
	reachable := len(allowed)
	if allowed == nil {
		if err := a.DB.QueryRow(r.Context(), `SELECT count(*) FROM mailbox`).Scan(&reachable); err != nil {
			return 0, nil, err
		}
	}
	return 200, map[string]any{
		"object": "api_key", "id": c.key.ID, "name": c.key.Name, "scopes": c.key.Scopes,
		"reach":                 map[string]any{"unrestricted": c.key.Reach.Unrestricted(), "domains": nonNil(c.key.Reach.DomainIDs), "mailboxes": nonNil(c.key.Reach.MailboxIDs)},
		"reachable_mailboxes":   reachable,
		"rate_limit_per_minute": c.key.RateLimit,
		"api":                   map[string]any{"version": "v1", "base_url": a.BaseURL, "all_scopes": apikey.Scopes, "webhook_events": webhook.Events},
	}, nil
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// within reports whether id is in allowed (nil = everything).
func within(allowed []string, id string) bool { return allowed == nil || slices.Contains(allowed, id) }
