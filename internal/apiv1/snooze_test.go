package apiv1_test

import (
	"context"
	"testing"
	"time"

	"github.com/shahriyardx/mails/internal/apikey"
)

func mustTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339, s)
	return t
}

func TestSnoozeThroughPatch(t *testing.T) {
	e := setup(t)
	e.receive(t, "sales@a.test", "Later")
	var id string
	_ = e.pool.QueryRow(context.Background(), `SELECT id FROM thread`).Scan(&id)
	reader := e.key(t, apikey.Input{Scopes: []string{"mail:read"}})
	writer := e.key(t, apikey.Input{Scopes: []string{"mail:read", "mail:write"}})
	until := time.Now().Add(time.Hour).UTC().Truncate(time.Second).Format(time.RFC3339)
	if r := e.call(t, reader, "PATCH", "/threads/"+id, map[string]any{"snoozed_until": until}); r.code != 403 {
		t.Fatalf("read-only key snoozed: %d", r.code)
	}
	r := e.call(t, writer, "PATCH", "/threads/"+id, map[string]any{"snoozed_until": until})
	got, _ := r.body["snoozed_until"].(string)
	if at, err := time.Parse(time.RFC3339, got); r.code != 200 || err != nil || !at.Equal(mustTime(until)) {
		t.Fatalf("snooze: %d %s", r.code, r.raw)
	}
	if r := e.call(t, writer, "GET", "/threads?folder=inbox", nil); len(r.body["data"].([]any)) != 0 {
		t.Fatalf("snoozed thread still in inbox: %s", r.raw)
	}
	if r := e.call(t, writer, "GET", "/threads?folder=snoozed", nil); len(r.body["data"].([]any)) != 1 {
		t.Fatalf("snoozed list: %s", r.raw)
	}
	if r := e.call(t, writer, "PATCH", "/threads/"+id, map[string]any{"snoozed_until": "2001-01-01T00:00:00Z"}); r.code != 422 {
		t.Fatalf("past time: %d", r.code)
	}
	if r := e.call(t, writer, "PATCH", "/threads/"+id, map[string]any{"snoozed_until": "soon"}); r.code < 400 || r.code >= 500 {
		t.Fatalf("bad time: %d %s", r.code, r.raw)
	}
	r = e.call(t, writer, "PATCH", "/threads/"+id, map[string]any{"snoozed_until": nil})
	if r.code != 200 || r.body["snoozed_until"] != nil {
		t.Fatalf("unsnooze: %d %s", r.code, r.raw)
	}
}
