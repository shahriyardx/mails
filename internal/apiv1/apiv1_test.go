package apiv1_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/apikey"
	"github.com/shahriyardx/mails/internal/apiv1"
	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/delivery"
	"github.com/shahriyardx/mails/internal/domain"
	"github.com/shahriyardx/mails/internal/idempotency"
	"github.com/shahriyardx/mails/internal/inbound"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/mailbox"
	"github.com/shahriyardx/mails/internal/realtime"
	"github.com/shahriyardx/mails/internal/send"
	"github.com/shahriyardx/mails/internal/ses/sesfake"
	"github.com/shahriyardx/mails/internal/storage"
	"github.com/shahriyardx/mails/internal/webhook"
)

type env struct {
	srv  *httptest.Server
	pool *pgxpool.Pool
	keys *apikey.Service
	ses  *sesfake.Fake
	in   *inbound.Service
}

func setup(t *testing.T) *env {
	t.Helper()
	pool := dbtest.New(t)
	_, err := pool.Exec(context.Background(), `
		INSERT INTO domain (id, name, region, status, sending_enabled) VALUES
			('dom_a', 'a.test', 'us-east-1', 'verified', true), ('dom_b', 'b.test', 'us-east-1', 'verified', true);
		INSERT INTO mailbox (id, address, domain, domain_id, display_name) VALUES
			('mbx_a', 'sales@a.test', 'a.test', 'dom_a', 'Sales'), ('mbx_b', 'ops@b.test', 'b.test', 'dom_b', 'Ops');`)
	if err != nil {
		t.Fatal(err)
	}
	store, hub, fake := storage.NewMemory(), realtime.NewHub(), sesfake.New()
	mailboxes := &mailbox.Service{DB: pool}
	mailSvc := &mail.Service{DB: pool, Store: store, Hub: hub}
	hooks := &webhook.Service{DB: pool, HTTP: http.DefaultClient, Now: time.Now}
	a := &apiv1.API{
		DB: pool, Keys: &apikey.Service{DB: pool}, Mailboxes: mailboxes, Mail: mailSvc,
		Domains:  &domain.Service{DB: pool, SES: fake, Region: "us-east-1", Selector: "mail", MailFromPrefix: "mail", Now: time.Now},
		Send:     &send.Service{DB: pool, SES: fake, Store: store, Mailboxes: mailboxes, Mail: mailSvc, Hub: hub, Now: time.Now},
		Delivery: &delivery.Service{DB: pool, SES: fake, Hub: hub, Now: time.Now},
		Webhooks: hooks, Idem: &idempotency.Store{DB: pool}, Events: hooks, BaseURL: "https://m.test/api/v1",
	}
	srv := httptest.NewServer(a.Routes())
	t.Cleanup(srv.Close)
	return &env{srv: srv, pool: pool, keys: a.Keys, ses: fake, in: &inbound.Service{DB: pool, Hub: hub, Now: time.Now}}
}

func (e *env) key(t *testing.T, in apikey.Input) string {
	t.Helper()
	if in.Name == "" {
		in.Name = "test"
	}
	_, token, err := e.keys.Create(context.Background(), in)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

type reply struct {
	code   int
	header http.Header
	body   map[string]any
	raw    string
}

func (e *env) call(t *testing.T, token, method, path string, body any, headers ...string) reply {
	t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rd)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	r := reply{code: res.StatusCode, header: res.Header, raw: string(raw)}
	_ = json.Unmarshal(raw, &r.body)
	return r
}

func (e *env) receive(t *testing.T, to, subject string) {
	t.Helper()
	text := "hi"
	if _, err := e.in.Ingest(context.Background(), &inbound.Payload{To: to, From: addr.Address{Address: "c@x.test"},
		Subject: subject, Text: &text}, nil); err != nil {
		t.Fatal(err)
	}
}

func TestAuthAndScopes(t *testing.T) {
	e := setup(t)
	if r := e.call(t, "", "GET", "/me", nil); r.code != 401 {
		t.Fatalf("no key: %d", r.code)
	}
	if r := e.call(t, "mk_live_nope", "GET", "/me", nil); r.code != 401 {
		t.Fatalf("bad key: %d", r.code)
	}
	sendOnly := e.key(t, apikey.Input{Scopes: []string{"emails:send"}})
	r := e.call(t, sendOnly, "GET", "/threads", nil)
	if r.code != 403 || r.body["required_scope"] != "mail:read" {
		t.Fatalf("missing scope: %d %s", r.code, r.raw)
	}
	r = e.call(t, sendOnly, "GET", "/me", nil)
	if r.code != 200 || r.body["reachable_mailboxes"].(float64) != 2 || r.header.Get("X-Ratelimit-Limit") != "300" {
		t.Fatalf("me: %d %s %v", r.code, r.raw, r.header)
	}
}

func TestReach(t *testing.T) {
	e := setup(t)
	e.receive(t, "sales@a.test", "For sales")
	e.receive(t, "ops@b.test", "For ops")
	sales := e.key(t, apikey.Input{Scopes: []string{"*"}, Reach: apikey.Reach{MailboxIDs: []string{"mbx_a"}}})

	r := e.call(t, sales, "GET", "/threads", nil)
	data := r.body["data"].([]any)
	if r.code != 200 || len(data) != 1 || data[0].(map[string]any)["mailbox"] != "sales@a.test" {
		t.Fatalf("threads: %d %s", r.code, r.raw)
	}
	var opsThread string
	_ = e.pool.QueryRow(context.Background(), `SELECT id FROM thread WHERE mailbox_id = 'mbx_b'`).Scan(&opsThread)
	if r := e.call(t, sales, "GET", "/threads/"+opsThread, nil); r.code != 404 {
		t.Fatalf("other mailbox thread: %d", r.code)
	}
	if r := e.call(t, sales, "PATCH", "/threads/"+opsThread, map[string]any{"is_read": true}); r.code != 404 {
		t.Fatalf("patch other thread: %d", r.code)
	}
	for _, c := range []struct{ method, path string }{{"GET", "/contacts"}, {"POST", "/domains"}} {
		if r := e.call(t, sales, c.method, c.path, map[string]string{"name": "c.test"}); r.code != 403 {
			t.Errorf("%s %s: %d", c.method, c.path, r.code)
		}
	}
	if r := e.call(t, sales, "POST", "/emails", map[string]any{"from": "ops@b.test", "to": "x@y.test", "text": "hi"}); r.code != 403 {
		t.Fatalf("send as other mailbox: %d %s", r.code, r.raw)
	}
	if r := e.call(t, sales, "POST", "/webhooks", map[string]any{"url": "https://example.com/h"}); r.code != 403 {
		t.Fatalf("unscoped webhook by restricted key: %d", r.code)
	}
	for _, c := range []struct{ method, path string }{{"GET", "/suppressions"}, {"DELETE", "/suppressions/x@y.test"}} {
		if r := e.call(t, sales, c.method, c.path, nil); r.code != 403 {
			t.Errorf("%s %s by restricted key: %d", c.method, c.path, r.code)
		}
	}
	for _, body := range []map[string]any{{"is_catch_all": true}, {"is_default": true}} {
		if r := e.call(t, sales, "PATCH", "/mailboxes/mbx_a", body); r.code != 403 {
			t.Errorf("mailbox key PATCH %v: %d %s", body, r.code, r.raw)
		}
	}
	if r := e.call(t, sales, "POST", "/domains/dom_a/verify", nil); r.code != 403 {
		t.Errorf("verify via a mailbox: %d", r.code)
	}
	newBlock := e.call(t, sales, "POST", "/suppressions", map[string]string{"address": "q@y.test"})
	oldBlock := e.call(t, sales, "POST", "/suppressions", map[string]string{"address": "q@y.test"})
	if newBlock.code != 200 || oldBlock.code != 200 || newBlock.raw != oldBlock.raw {
		t.Errorf("restricted block replies differ: %d %s / %d %s", newBlock.code, newBlock.raw, oldBlock.code, oldBlock.raw)
	}
	r = e.call(t, sales, "GET", "/mailboxes", nil)
	if len(r.body["data"].([]any)) != 1 {
		t.Fatalf("mailboxes: %s", r.raw)
	}

	// A domain key may send from a new address on its domain, created on use.
	dom := e.key(t, apikey.Input{Scopes: []string{"emails:send"}, Reach: apikey.Reach{DomainIDs: []string{"dom_a"}}})
	if r := e.call(t, dom, "POST", "/emails", map[string]any{"from": "noreply@a.test", "to": "x@y.test", "text": "hi"}); r.code != 202 {
		t.Fatalf("domain key new address: %d %s", r.code, r.raw)
	}
	if r := e.call(t, dom, "POST", "/emails", map[string]any{"from": "noreply@b.test", "to": "x@y.test", "text": "hi"}); r.code != 403 {
		t.Fatalf("domain key other domain: %d", r.code)
	}
	var n int
	_ = e.pool.QueryRow(context.Background(), `SELECT count(*) FROM mailbox WHERE address = 'noreply@b.test'`).Scan(&n)
	if n != 0 {
		t.Fatal("refused send still created a mailbox")
	}
}

func TestIdempotencyAndBatch(t *testing.T) {
	e := setup(t)
	k := e.key(t, apikey.Input{Scopes: []string{"*"}})
	msg := map[string]any{"from": "sales@a.test", "to": []string{"x@y.test"}, "subject": "Receipt", "text": "hi"}
	first := e.call(t, k, "POST", "/emails", msg, "Idempotency-Key", "receipt-1")
	again := e.call(t, k, "POST", "/emails", msg, "Idempotency-Key", "receipt-1")
	if first.code != 202 || again.code != 202 || again.header.Get("Idempotency-Replayed") != "true" || first.body["id"] != again.body["id"] {
		t.Fatalf("replay: %d %d %v %v", first.code, again.code, first.body["id"], again.body["id"])
	}
	if e.ses.SentCount() != 1 {
		t.Fatalf("sent %d times", e.ses.SentCount())
	}
	msg["subject"] = "Changed"
	if r := e.call(t, k, "POST", "/emails", msg, "Idempotency-Key", "receipt-1"); r.code != 409 {
		t.Fatalf("changed body: %d", r.code)
	}
	if r := e.call(t, k, "POST", "/emails", map[string]any{"from": "sales@a.test", "to": "x@y.test", "template": "t"}); r.code != 422 {
		t.Fatalf("template field: %d", r.code)
	}
	r := e.call(t, k, "POST", "/emails/batch", []map[string]any{
		{"from": "sales@a.test", "to": "a@y.test", "text": "1"},
		{"from": "nobody@zzz.test", "to": "b@y.test", "text": "2"},
	})
	if r.code != 207 || r.body["sent"].(float64) != 1 || r.body["failed"].(float64) != 1 {
		t.Fatalf("batch: %d %s", r.code, r.raw)
	}
	list := e.call(t, k, "GET", "/emails?status=sent", nil)
	if len(list.body["data"].([]any)) != 2 {
		t.Fatalf("emails list: %s", list.raw)
	}
}

func TestRateLimitAndSuppressions(t *testing.T) {
	e := setup(t)
	limit := 2
	k := e.key(t, apikey.Input{Scopes: []string{"*"}, RateLimit: &limit})
	if r := e.call(t, k, "POST", "/suppressions", map[string]string{"address": "Gone@x.test"}); r.code != 201 {
		t.Fatalf("new: %d %s", r.code, r.raw)
	}
	if r := e.call(t, k, "POST", "/suppressions", map[string]string{"address": "gone@x.test"}); r.code != 200 {
		t.Fatalf("existing: %d %s", r.code, r.raw)
	}
	r := e.call(t, k, "GET", "/suppressions", nil)
	if r.code != 429 || !strings.Contains(r.raw, "rate_limited") {
		t.Fatalf("third call: %d %s", r.code, r.raw)
	}
}

// Blocking an address already blocked returns that exact block, not one
// that merely contains it, and spacing does not matter.
func TestAddSuppressionAgainReturnsExactBlock(t *testing.T) {
	e := setup(t)
	k := e.key(t, apikey.Input{Scopes: []string{"*"}})
	for _, a := range []string{"a@b.test", "xa@b.test"} {
		if r := e.call(t, k, "POST", "/suppressions", map[string]string{"address": a}); r.code != 201 {
			t.Fatalf("block %s: %d %s", a, r.code, r.raw)
		}
	}
	for _, again := range []string{"a@b.test", " A@b.test "} {
		r := e.call(t, k, "POST", "/suppressions", map[string]string{"address": again})
		if r.code != 200 || r.body["address"] != "a@b.test" {
			t.Errorf("block %q again: %d %s", again, r.code, r.raw)
		}
	}
}

// The daily series has a row per day, so the window is capped at 366 days
// whichever way it is given.
func TestStatsWindowIsBounded(t *testing.T) {
	e := setup(t)
	k := e.key(t, apikey.Input{Scopes: []string{"*"}})
	for _, c := range []struct {
		query string
		want  int
	}{
		{"", 200},
		{"?days=365", 200},
		{"?days=366", 422},
		{"?since=2026-01-01&until=2027-01-02", 200},
		{"?since=2026-01-01&until=2027-01-03", 422},
		{"?since=1000-01-01", 422},
		{"?since=2026-02-01&until=2026-01-01", 422},
		{"?until=2026-01-01", 200},
	} {
		if r := e.call(t, k, "GET", "/stats"+c.query, nil); r.code != c.want {
			t.Errorf("%s: %d, want %d (%s)", c.query, r.code, c.want, r.raw)
		}
	}
}

// Sent mail counts on the day it went out: a draft saved 40 days ago and
// sent today is in today's numbers everywhere, not missing from some.
func TestStatsCountSentMailWhenSent(t *testing.T) {
	e := setup(t)
	k := e.key(t, apikey.Input{Scopes: []string{"*"}})
	now := time.Now().UTC()
	if _, err := e.pool.Exec(context.Background(), `
		INSERT INTO thread (id, mailbox_id, subject, last_message_at) VALUES ('thr_1', 'mbx_a', 'x', $1)`, now); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(context.Background(), `
		INSERT INTO message (id, thread_id, mailbox_id, from_address, subject, folder, is_outbound, delivery_status,
			created_at, received_at, sent_at)
		VALUES ('msg_old', 'thr_1', 'mbx_a', 'sales@a.test', 'x', 'sent', true, 'delivered', $1::timestamptz - interval '40 days', $1, $1)`,
		now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	r := e.call(t, k, "GET", "/stats?days=7", nil)
	if r.code != 200 {
		t.Fatalf("stats: %d %s", r.code, r.raw)
	}
	if got := r.body["sending"].(map[string]any)["sent"]; got != 1.0 {
		t.Errorf("sending.sent = %v, want 1", got)
	}
	days := r.body["days"].([]any)
	var sent float64
	for _, d := range days {
		sent += d.(map[string]any)["sent"].(float64)
	}
	if sent != 1 {
		t.Errorf("days sent = %v, want 1", sent)
	}
	for _, b := range r.body["mailboxes"].([]any) {
		if b := b.(map[string]any); b["id"] == "mbx_a" && b["sent"] != 1.0 {
			t.Errorf("mailbox sent = %v, want 1", b["sent"])
		}
	}
}

func TestDomainKeySeesItsDomainWebhook(t *testing.T) {
	e := setup(t)
	dom := e.key(t, apikey.Input{Scopes: []string{"webhooks:write"}, Reach: apikey.Reach{DomainIDs: []string{"dom_a"}}})
	_, _ = e.pool.Exec(context.Background(), `INSERT INTO webhook (id, url, secret, domain_id) VALUES ('whk_d', 'https://example.com/h', 's', 'dom_a'),
		('whk_other', 'https://example.com/h', 's', 'dom_b')`)
	r := e.call(t, dom, "GET", "/webhooks", nil)
	data := r.body["data"].([]any)
	if len(data) != 1 || data[0].(map[string]any)["id"] != "whk_d" {
		t.Fatalf("list: %s", r.raw)
	}
	if r := e.call(t, dom, "DELETE", "/webhooks/whk_other", nil); r.code != 404 {
		t.Fatalf("other domain hook: %d", r.code)
	}
	if r := e.call(t, dom, "DELETE", "/webhooks/whk_d", nil); r.code != 200 {
		t.Fatalf("own domain hook: %d %s", r.code, r.raw)
	}
	if r := e.call(t, dom, "POST", "/labels", map[string]string{"name": "x"}); r.code != 403 {
		t.Fatalf("label write by restricted key: %d", r.code)
	}
}
