package mail_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/inbound"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/page"
)

func snooze(at time.Time) mail.ThreadChange {
	return mail.ThreadChange{SnoozedUntil: httpx.Opt[time.Time]{Set: true, Value: at}}
}

func (e *env) list(t *testing.T, folder string) []string {
	t.Helper()
	l, err := e.s.ListThreads(context.Background(), mail.ThreadFilter{Folder: folder, Page: page.Params{Limit: 25}})
	if err != nil {
		t.Fatal(err)
	}
	return ids(l)
}

func TestSnoozeHidesFromInboxAndCounts(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	a := e.receive(t, "one@a.test", "x@out.test", "Alpha")
	b := e.receive(t, "one@a.test", "y@out.test", "Beta")
	if _, err := e.s.ChangeThreads(ctx, nil, []string{a}, snooze(time.Now().Add(time.Hour))); err != nil {
		t.Fatal(err)
	}
	if got := e.list(t, "inbox"); len(got) != 1 || got[0] != b {
		t.Fatalf("inbox = %v", got)
	}
	if got := e.list(t, "snoozed"); len(got) != 1 || got[0] != a {
		t.Fatalf("snoozed = %v", got)
	}
	c, err := e.s.Counts(ctx, nil, "", "")
	if err != nil || c.Folders["inbox"] != 1 || c.Mailboxes["mbx_1"] != 1 {
		t.Fatalf("counts = %+v %v", c, err)
	}
	th, _ := e.s.GetThread(ctx, nil, a, false)
	if th.SnoozedUntil == nil {
		t.Fatal("snoozed_until not on the thread")
	}
	if _, err := e.s.ChangeThreads(ctx, nil, []string{b}, snooze(time.Now().Add(-time.Minute))); code(err) != 422 {
		t.Fatalf("snooze into the past: %v", err)
	}
	// null wakes it at once.
	if _, err := e.s.ChangeThreads(ctx, nil, []string{a}, mail.ThreadChange{SnoozedUntil: httpx.Opt[time.Time]{Set: true, Null: true}}); err != nil {
		t.Fatal(err)
	}
	if got := e.list(t, "inbox"); len(got) != 2 {
		t.Fatalf("inbox after unsnooze = %v", got)
	}
	// The change echoes back as sent (webhooks carry it).
	out, _ := json.Marshal(mail.ThreadChange{SnoozedUntil: httpx.Opt[time.Time]{Set: true, Null: true}})
	if string(out) != `{"folder":null,"is_read":null,"is_starred":null,"add_labels":null,"remove_labels":null,"snoozed_until":null}` {
		t.Fatalf("change json = %s", out)
	}
	out, _ = json.Marshal(mail.ThreadChange{})
	if string(out) != `{"folder":null,"is_read":null,"is_starred":null,"add_labels":null,"remove_labels":null}` {
		t.Fatalf("unset change json = %s", out)
	}
}

func TestWakeSnoozedBringsBackUnread(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	var woke []string
	e.s.OnWake = func(_ context.Context, id, subject string) { woke = append(woke, id+":"+subject) }
	a := e.receive(t, "one@a.test", "x@out.test", "Alpha")
	b := e.receive(t, "one@a.test", "y@out.test", "Beta")
	trashed := e.receive(t, "one@a.test", "z@out.test", "Gone")
	// Read and archived, then snoozed: it comes back to the Inbox, unread.
	if _, err := e.s.ChangeThreads(ctx, nil, []string{a}, mail.ThreadChange{IsRead: ptr(true), Folder: ptr("archive")}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.ChangeThreads(ctx, nil, []string{trashed}, mail.ThreadChange{Folder: ptr("trash")}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{a, b, trashed} {
		if _, err := e.s.ChangeThreads(ctx, nil, []string{id}, snooze(time.Now().Add(time.Hour))); err != nil {
			t.Fatal(err)
		}
	}
	// a and trashed are due; b is not.
	if _, err := e.pool.Exec(ctx, `UPDATE thread SET snoozed_until = now() - interval '1 second' WHERE id = ANY($1)`, []string{a, trashed}); err != nil {
		t.Fatal(err)
	}
	if err := e.s.WakeSnoozed(ctx); err != nil {
		t.Fatal(err)
	}
	if got := e.list(t, "inbox"); len(got) != 1 || got[0] != a {
		t.Fatalf("inbox = %v", got)
	}
	if got := e.list(t, "snoozed"); len(got) != 1 || got[0] != b {
		t.Fatalf("snoozed = %v", got)
	}
	if got := e.list(t, "trash"); len(got) != 1 || got[0] != trashed {
		t.Fatalf("trash = %v (a trashed thread stays there)", got)
	}
	th, _ := e.s.GetThread(ctx, nil, a, false)
	if th.UnreadCount != 1 || th.SnoozedUntil != nil {
		t.Fatalf("woken thread: unread=%d snoozed=%v", th.UnreadCount, th.SnoozedUntil)
	}
	if len(woke) != 2 {
		t.Fatalf("OnWake = %v", woke)
	}
	// Nothing left due: a second run does nothing.
	woke = nil
	if err := e.s.WakeSnoozed(ctx); err != nil || len(woke) != 0 {
		t.Fatalf("second run: %v %v", woke, err)
	}
}

func TestNewMailUnsnoozes(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	first, reply := "<m1@out.test>", "<m2@out.test>"
	text := "hi"
	ingest := func(id string, inReplyTo *string) string {
		t.Helper()
		e.n++
		res, err := e.in.Ingest(ctx, &inbound.Payload{To: "one@a.test", From: addr.Address{Address: "x@out.test"},
			ToAddresses: []addr.Address{{Address: "one@a.test"}}, Subject: "Plan", Text: &text, MessageID: &id, InReplyTo: inReplyTo}, nil)
		if err != nil || len(res.Stored) != 1 {
			t.Fatalf("ingest: %+v %v", res, err)
		}
		var thread string
		_ = e.pool.QueryRow(ctx, `SELECT thread_id FROM message WHERE id = $1`, res.Stored[0]).Scan(&thread)
		return thread
	}
	a := ingest(first, nil)
	if _, err := e.s.ChangeThreads(ctx, nil, []string{a}, snooze(time.Now().Add(24*time.Hour))); err != nil {
		t.Fatal(err)
	}
	if got := ingest(reply, &first); got != a {
		t.Fatalf("reply threaded into %s, want %s", got, a)
	}
	if got := e.list(t, "inbox"); len(got) != 1 || got[0] != a {
		t.Fatalf("inbox after reply = %v", got)
	}
}
