package send_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shahriyardx/mails/internal/auth"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/send"
)

// An undoable send waits in the queue, untouched by SES, until its window
// ends; then the outbox sends it like any queued job.
func TestUndoableSendWaitsForItsWindow(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	res, err := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("a@b.test"), Subject: "Hold", Text: "x", UndoWindow: 10 * time.Second})
	if err != nil || res.Status != "queued" || res.UndoUntil == nil || !res.UndoUntil.Equal(e.now.Add(10*time.Second)) {
		t.Fatalf("send: %+v %v", res, err)
	}
	if e.ses.SentCount() != 0 {
		t.Fatal("SES saw the mail inside the undo window")
	}
	e.now = e.now.Add(9 * time.Second)
	if worked, _ := e.s.ProcessOne(ctx); worked {
		t.Fatal("outbox took the job inside the undo window")
	}
	e.now = e.now.Add(time.Second)
	if worked, err := e.s.ProcessOne(ctx); !worked || err != nil {
		t.Fatalf("outbox: %v %v", worked, err)
	}
	var status string
	_ = e.pool.QueryRow(ctx, `SELECT delivery_status::text FROM message WHERE id = $1`, res.ID).Scan(&status)
	if e.ses.SentCount() != 1 || status != "sent" {
		t.Fatalf("sent=%d status=%s", e.ses.SentCount(), status)
	}
	if got := e.rec.Types(); len(got) != 1 || got[0] != "email.sent" {
		t.Fatalf("events = %v", got)
	}
}

// Undo inside the window gives the draft back: same id and thread, files
// kept, job gone, nothing sent or announced.
func TestUndoInsideWindowRestoresDraft(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	m := &mail.Service{DB: e.pool, Store: e.store}
	file, err := m.Stage(ctx, "a.txt", "text/plain", strings.NewReader("AAA"))
	if err != nil {
		t.Fatal(err)
	}
	d, err := e.s.SaveDraft(ctx, send.Input{From: "me@a.test", To: to("a@b.test"), Subject: "Oops", Text: "x", AttachmentIDs: []string{file.ID}})
	if err != nil {
		t.Fatal(err)
	}
	res, err := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("a@b.test"), Subject: "Oops", Text: "x",
		AttachmentIDs: []string{file.ID}, DraftID: d.ID, UndoWindow: 10 * time.Second})
	if err != nil || res.ID != d.ID {
		t.Fatalf("send: %+v %v", res, err)
	}
	e.now = e.now.Add(5 * time.Second)
	if err := e.s.Cancel(ctx, nil, res.ID); err != nil {
		t.Fatal(err)
	}
	var folder, folders string
	var isDraft bool
	var status *string
	var jobs, files int
	_ = e.pool.QueryRow(ctx, `SELECT folder::text, is_draft, delivery_status::text FROM message WHERE id = $1`, d.ID).Scan(&folder, &isDraft, &status)
	_ = e.pool.QueryRow(ctx, `SELECT array_to_string(folders, ',') FROM thread WHERE id = $1`, d.ThreadID).Scan(&folders)
	_ = e.pool.QueryRow(ctx, `SELECT count(*) FROM send_job`).Scan(&jobs)
	_ = e.pool.QueryRow(ctx, `SELECT count(*) FROM attachment WHERE message_id = $1`, d.ID).Scan(&files)
	if folder != "drafts" || !isDraft || status != nil || folders != "drafts" || jobs != 0 || files != 1 {
		t.Fatalf("after undo: folder=%s draft=%v status=%v thread=%s jobs=%d files=%d", folder, isDraft, status, folders, jobs, files)
	}
	e.now = e.now.Add(time.Hour)
	if worked, _ := e.s.ProcessOne(ctx); worked || e.ses.SentCount() != 0 || len(e.rec.Types()) != 0 {
		t.Fatalf("undone mail went out: sent=%d events=%v", e.ses.SentCount(), e.rec.Types())
	}
	// The draft sends again, files and all.
	if _, err := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("a@b.test"), Subject: "Oops", Text: "x",
		AttachmentIDs: []string{file.ID}, DraftID: d.ID}); err != nil {
		t.Fatal(err)
	}
	if e.ses.SentCount() != 1 || !strings.Contains(string(e.ses.Sent[0].Raw), "a.txt") {
		t.Fatal("re-sent draft lost its file")
	}
}

func TestUndoAfterWindowOrClaimIsConflict(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	late, _ := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("a@b.test"), Text: "x", UndoWindow: 5 * time.Second})
	e.now = e.now.Add(5 * time.Second)
	if err := e.s.Cancel(ctx, nil, late.ID); code(err) != 409 {
		t.Fatalf("undo at the window's end: %v", err)
	}
	if worked, _ := e.s.ProcessOne(ctx); !worked {
		t.Fatal("job not sent after the window")
	}
	if err := e.s.Cancel(ctx, nil, late.ID); code(err) != 409 {
		t.Fatalf("undo after send: %v", err)
	}
	other, _ := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("a@b.test"), Text: "y", UndoWindow: 5 * time.Second})
	if err := e.s.Cancel(ctx, []string{"mbx_x"}, other.ID); code(err) != 404 {
		t.Fatalf("undo out of reach: %v", err)
	}
}

// Without a window (every /api/v1 send) mail goes to SES at once.
func TestSendWithoutWindowIsImmediate(t *testing.T) {
	e := setup(t)
	res, err := e.s.Send(context.Background(), send.Input{From: "me@a.test", To: to("a@b.test"), Text: "x", APIKeyID: ""})
	if err != nil || res.Status != "sent" || res.UndoUntil != nil || e.ses.SentCount() != 1 {
		t.Fatalf("send: %+v %v sent=%d", res, err, e.ses.SentCount())
	}
}

// The outbox wakes when an undo window ends, not at its next idle poll.
func TestOutboxWakesWhenWindowEnds(t *testing.T) {
	e := setup(t)
	e.s.Now = time.Now
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { e.s.RunOutbox(ctx); close(done) }()
	defer func() { cancel(); <-done }()
	if _, err := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("a@b.test"), Text: "x", UndoWindow: time.Second}); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for e.ses.SentCount() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("outbox did not send when the undo window ended")
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// The dashboard's send route holds mail for the owner's undo window (10 s
// unless changed) and Cancel through it hands back the draft; a window of
// 0 sends at once.
func TestDashboardSendUsesUndoPreference(t *testing.T) {
	e := setup(t)
	ctx := auth.WithOwner(context.Background(), &auth.Owner{ID: "usr_1"})
	if _, err := e.pool.Exec(ctx, `INSERT INTO app_user (id, github_id, login, name, email) VALUES ('usr_1', 1, 'o', 'O', 'o@x')`); err != nil {
		t.Fatal(err)
	}
	h := send.Routes(e.s)
	post := func(path, body string) (int, map[string]any) {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequestWithContext(ctx, "POST", path, strings.NewReader(body)))
		var out map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &out)
		return w.Code, out
	}
	msg := `{"from": "me@a.test", "to": "a@b.test", "text": "x"}`
	code, res := post("/send", msg)
	if code != 202 || res["status"] != "queued" || res["undo_until"] == nil || e.ses.SentCount() != 0 {
		t.Fatalf("held send: %d %v", code, res)
	}
	code, draft := post("/emails/"+res["id"].(string)+"/cancel", "")
	if code != 200 || draft["is_draft"] != true || draft["folder"] != "drafts" {
		t.Fatalf("undo: %d %v", code, draft)
	}
	if _, err := e.pool.Exec(ctx, `INSERT INTO preference (user_id, undo_send_seconds) VALUES ('usr_1', 0)`); err != nil {
		t.Fatal(err)
	}
	if code, res = post("/send", msg); code != 202 || res["status"] != "sent" || e.ses.SentCount() != 1 {
		t.Fatalf("window 0: %d %v", code, res)
	}
}
