package webhook_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/events"
	"github.com/shahriyardx/mails/internal/page"
	"github.com/shahriyardx/mails/internal/webhook"
)

type receiver struct {
	mu     sync.Mutex
	codes  []int // replies, in order; last one repeats
	got    []*http.Request
	bodies [][]byte
}

func (r *receiver) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	r.mu.Lock()
	defer r.mu.Unlock()
	b, _ := io.ReadAll(req.Body)
	r.got, r.bodies = append(r.got, req), append(r.bodies, b)
	code := r.codes[min(len(r.got)-1, len(r.codes)-1)]
	w.WriteHeader(code)
	_, _ = w.Write([]byte(`{"ok":true}`))
}

type env struct {
	s   *webhook.Service
	rec *receiver
	url string
	now time.Time
}

func setup(t *testing.T, codes ...int) *env {
	t.Helper()
	pool := dbtest.New(t)
	_, err := pool.Exec(context.Background(), `
		INSERT INTO domain (id, name, region) VALUES ('dom_a', 'a.test', 'x');
		INSERT INTO mailbox (id, address, domain, domain_id, display_name) VALUES
			('mbx_a', 'x@a.test', 'a.test', 'dom_a', 'x'), ('mbx_o', 'x@o.test', 'o.test', NULL, 'x')`)
	if err != nil {
		t.Fatal(err)
	}
	rec := &receiver{codes: codes}
	srv := httptest.NewServer(rec)
	t.Cleanup(srv.Close)
	e := &env{rec: rec, url: strings.Replace(srv.URL, "127.0.0.1", "localhost", 1), now: time.Now()}
	e.s = &webhook.Service{DB: pool, HTTP: srv.Client(), Now: func() time.Time { return e.now }, AllowLocal: true}
	return e
}

func (e *env) drain(t *testing.T) {
	t.Helper()
	for {
		worked, err := e.s.DeliverOne(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if !worked {
			return
		}
	}
}

func TestEmitScopesAndSigns(t *testing.T) {
	e := setup(t, 200)
	ctx := context.Background()
	all, err := e.s.Create(ctx, webhook.Input{URL: e.url})
	if err != nil || !strings.HasPrefix(all.Secret, "whsec_") {
		t.Fatalf("create: %+v %v", all, err)
	}
	dom := "dom_a"
	if _, err := e.s.Create(ctx, webhook.Input{URL: e.url, DomainID: &dom, Events: []string{"email.sent"}}); err != nil {
		t.Fatal(err)
	}
	e.s.Emit(ctx, events.Event{Type: "mail.received", MailboxID: "mbx_a", Data: map[string]any{"n": 1}})
	e.s.Emit(ctx, events.Event{Type: "email.sent", MailboxID: "mbx_a", Data: map[string]any{"n": 2}})
	e.s.Emit(ctx, events.Event{Type: "email.sent", MailboxID: "mbx_o", Data: map[string]any{"n": 3}})
	e.drain(t)
	// Unscoped hears all three; the domain one hears only email.sent on a.test.
	if len(e.rec.got) != 4 {
		t.Fatalf("deliveries = %d, want 4", len(e.rec.got))
	}
	req, body := e.rec.got[0], e.rec.bodies[0]
	sig := req.Header.Get("X-Mails-Signature")
	parts := strings.Split(sig, ",")
	mac := hmac.New(sha256.New, []byte(all.Secret))
	mac.Write([]byte(strings.TrimPrefix(parts[0], "t=") + "."))
	mac.Write(body)
	if "v1="+hex.EncodeToString(mac.Sum(nil)) != parts[1] || req.Header.Get("X-Mails-Event") == "" {
		t.Fatalf("bad signature %q", sig)
	}
	var env struct {
		ID, Object, Type string
		Data             map[string]any
	}
	_ = json.Unmarshal(body, &env)
	if !strings.HasPrefix(env.ID, "whd_") || env.Object != "event" || env.Data["n"] == nil {
		t.Fatalf("envelope = %+v", env)
	}
}

func TestRetriesThenGivesUpOrSucceeds(t *testing.T) {
	e := setup(t, 500, 500, 200)
	ctx := context.Background()
	if _, err := e.s.Create(ctx, webhook.Input{URL: e.url}); err != nil {
		t.Fatal(err)
	}
	e.s.Emit(ctx, events.Event{Type: "email.sent", Data: map[string]any{}})
	for range 3 {
		e.drain(t)
		e.now = e.now.Add(time.Minute)
	}
	l, _ := e.s.Deliveries(ctx, webhook.DeliveryFilter{Page: page.Params{Limit: 10}})
	if len(l.Data) != 3 || !l.Data[0].Succeeded || l.Data[0].Attempt != 3 || l.Data[0].EventID != l.Data[2].ID {
		t.Fatalf("deliveries = %+v", l.Data)
	}

	g := setup(t, 401)
	hook, _ := g.s.Create(ctx, webhook.Input{URL: g.url})
	g.s.Emit(ctx, events.Event{Type: "email.sent", Data: map[string]any{}})
	for range 3 {
		g.drain(t)
		g.now = g.now.Add(time.Minute)
	}
	if len(g.rec.got) != 1 {
		t.Fatalf("401 retried: %d calls", len(g.rec.got))
	}
	w, _ := g.s.Get(ctx, nil, hook.ID)
	if w.ConsecutiveFailures != 1 || *w.LastStatus != 401 {
		t.Fatalf("state = %+v", w)
	}
}

func TestDisablesAfterTwentyAndReenableClears(t *testing.T) {
	e := setup(t, 400)
	ctx := context.Background()
	hook, _ := e.s.Create(ctx, webhook.Input{URL: e.url})
	for range 20 {
		e.s.Emit(ctx, events.Event{Type: "email.sent", Data: map[string]any{}})
	}
	e.drain(t)
	w, _ := e.s.Get(ctx, nil, hook.ID)
	if w.Enabled || w.ConsecutiveFailures != 20 {
		t.Fatalf("after 20: %+v", w)
	}
	on := true
	if w, _ = e.s.Update(ctx, nil, hook.ID, webhook.Patch{Enabled: &on}); !w.Enabled || w.ConsecutiveFailures != 0 {
		t.Fatalf("re-enabled: %+v", w)
	}
}

func TestPingReplayAndValidation(t *testing.T) {
	e := setup(t, 200)
	ctx := context.Background()
	if _, err := e.s.Create(ctx, webhook.Input{URL: "http://example.com/hook"}); err == nil {
		t.Fatal("accepted http")
	}
	if _, err := e.s.Create(ctx, webhook.Input{URL: e.url, Events: []string{"webhook.test"}}); err == nil {
		t.Fatal("accepted webhook.test as a subscription")
	}
	hook, _ := e.s.Create(ctx, webhook.Input{URL: e.url})
	r, err := e.s.Ping(ctx, nil, hook.ID)
	if err != nil || !r.Succeeded || *r.StatusCode != 200 || *r.ResponseBody != `{"ok":true}` {
		t.Fatalf("ping = %+v %v", r, err)
	}
	if _, err := e.s.Ping(ctx, []string{"mbx_a"}, hook.ID); err == nil {
		t.Fatal("restricted caller pinged an unscoped hook")
	}
	again, err := e.s.Replay(ctx, nil, r.DeliveryID)
	if err != nil || !again.Succeeded {
		t.Fatalf("replay = %+v %v", again, err)
	}
	var first, second struct{ ID string }
	_ = json.Unmarshal(e.rec.bodies[0], &first)
	_ = json.Unmarshal(e.rec.bodies[1], &second)
	if first.ID != second.ID {
		t.Fatalf("replay changed the event id: %s vs %s", first.ID, second.ID)
	}
	rot, _ := e.s.Update(ctx, nil, hook.ID, webhook.Patch{RotateSecret: true})
	if rot.Secret == "" || rot.Secret == hook.Secret {
		t.Fatal("secret not rotated")
	}
	if read, _ := e.s.Get(ctx, nil, hook.ID); read.Secret != "" {
		t.Fatal("secret returned on a read")
	}
}
