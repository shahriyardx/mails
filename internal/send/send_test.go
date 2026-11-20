package send_test

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/sesv2/types"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/events"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/mailbox"
	"github.com/shahriyardx/mails/internal/realtime"
	"github.com/shahriyardx/mails/internal/send"
	"github.com/shahriyardx/mails/internal/ses/sesfake"
	"github.com/shahriyardx/mails/internal/storage"
)

type env struct {
	s     *send.Service
	ses   *sesfake.Fake
	pool  *pgxpool.Pool
	store *storage.Memory
	rec   *events.Recorder
	now   time.Time
}

func setup(t *testing.T) *env {
	t.Helper()
	pool := dbtest.New(t)
	_, err := pool.Exec(context.Background(), `
		INSERT INTO domain (id, name, region, status, sending_enabled) VALUES
			('dom_a', 'a.test', 'us-east-1', 'verified', true), ('dom_p', 'pending.test', 'us-east-1', 'pending', false);
		INSERT INTO mailbox (id, address, domain, domain_id, display_name) VALUES ('mbx_1', 'me@a.test', 'a.test', 'dom_a', 'Me');`)
	if err != nil {
		t.Fatal(err)
	}
	e := &env{ses: sesfake.New(), pool: pool, store: storage.NewMemory(), rec: &events.Recorder{},
		now: time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)}
	hub := realtime.NewHub()
	e.s = &send.Service{DB: pool, SES: e.ses, Store: e.store, Mailboxes: &mailbox.Service{DB: pool},
		Mail: &mail.Service{DB: pool, Store: e.store, Hub: hub}, Hub: hub, Events: e.rec, Now: func() time.Time { return e.now }}
	return e
}

func code(err error) int {
	var e *httpx.Error
	if errors.As(err, &e) {
		return e.Status
	}
	return 0
}

func to(s ...string) send.Recipients {
	var r send.Recipients
	for _, a := range s {
		r = append(r, addr.ParseList(a)...)
	}
	return r
}

func TestSendRecordsAndHidesBcc(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	res, err := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("Ada <ada@b.test>"), Bcc: to("secret@c.test"),
		Subject: "Hi", Text: "hello", Headers: map[string]string{"X-Order": "1"}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "sent" || res.SESMessageID == nil || res.From != "me@a.test" {
		t.Fatalf("result = %+v", res)
	}
	sent := e.ses.Sent[0]
	if strings.Join(sent.To, ",") != "ada@b.test,secret@c.test" {
		t.Fatalf("envelope = %v", sent.To)
	}
	if bytes.Contains(sent.Raw, []byte("secret@c.test")) {
		t.Fatal("bcc address leaked into the message")
	}
	if !bytes.Contains(sent.Raw, []byte(`"Me" <me@a.test>`)) && !bytes.Contains(sent.Raw, []byte(`Me <me@a.test>`)) {
		t.Fatalf("from header missing display name:\n%s", sent.Raw[:300])
	}
	var folder, status string
	var html string
	err = e.pool.QueryRow(ctx, `SELECT folder::text, delivery_status::text, html_body FROM message WHERE id = $1`, res.ID).Scan(&folder, &status, &html)
	if err != nil || folder != "sent" || status != "sent" || html != "<p>hello</p>" {
		t.Fatalf("row: %s %s %q %v", folder, status, html, err)
	}
	if got := e.rec.Types(); len(got) != 1 || got[0] != "email.sent" {
		t.Fatalf("events = %v", got)
	}
	var contacts int
	_ = e.pool.QueryRow(ctx, `SELECT count(*) FROM contact`).Scan(&contacts)
	if contacts != 1 {
		t.Fatalf("contacts = %d (bcc must not become a contact)", contacts)
	}
}

func TestSendRefusals(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	_, _ = e.pool.Exec(ctx, `INSERT INTO suppression (id, address, reason) VALUES ('sup_1', 'bounced@b.test', 'bounce')`)
	tests := []struct {
		name string
		in   send.Input
		want int
	}{
		{"no recipients", send.Input{From: "me@a.test", Subject: "x"}, 422},
		{"unverified domain", send.Input{From: "x@pending.test", To: to("a@b.test")}, 422},
		{"unknown domain", send.Input{From: "x@nowhere.test", To: to("a@b.test")}, 422},
		{"suppressed", send.Input{From: "me@a.test", To: to("ok@b.test, bounced@b.test")}, 409},
		{"reserved header", send.Input{From: "me@a.test", To: to("a@b.test"), Headers: map[string]string{"From": "x"}}, 422},
		{"out of reach", send.Input{From: "me@a.test", To: to("a@b.test"), Allowed: []string{"mbx_other"}}, 403},
	}
	for _, tt := range tests {
		if _, err := e.s.Send(ctx, tt.in); code(err) != tt.want {
			t.Errorf("%s: err = %v, want %d", tt.name, err, tt.want)
		}
	}
	// SES refusing for good records nothing.
	e.ses.SendErr = &types.MessageRejected{Message: new(string)}
	if _, err := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("a@b.test")}); code(err) != 422 {
		t.Fatalf("rejected: %v", err)
	}
	var n int
	_ = e.pool.QueryRow(ctx, `SELECT count(*) FROM message`).Scan(&n)
	if n != 0 {
		t.Fatalf("messages = %d after refusals", n)
	}
	// A new address on a verified domain is created on first send.
	e.ses.SendErr = nil
	if _, err := e.s.Send(ctx, send.Input{From: "noreply@a.test", To: to("a@b.test")}); err != nil {
		t.Fatal(err)
	}
}

func TestQueueRetriesThenSends(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	e.ses.SendErr = errors.New("throttled")
	res, err := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("a@b.test"), Subject: "Later"})
	if err != nil || res.Status != "queued" {
		t.Fatalf("send: %+v %v", res, err)
	}
	// Not due yet.
	if worked, _ := e.s.ProcessOne(ctx); worked {
		t.Fatal("job ran before its time")
	}
	e.now = e.now.Add(time.Minute)
	if worked, err := e.s.ProcessOne(ctx); !worked || err != nil {
		t.Fatalf("retry: %v %v", worked, err)
	}
	var attempts int
	_ = e.pool.QueryRow(ctx, `SELECT attempts FROM send_job`).Scan(&attempts)
	if attempts != 2 {
		t.Fatalf("attempts = %d", attempts)
	}
	e.ses.SendErr = nil
	e.now = e.now.Add(time.Hour)
	if worked, err := e.s.ProcessOne(ctx); !worked || err != nil {
		t.Fatalf("final: %v %v", worked, err)
	}
	var status, jobStatus string
	var rawLen int
	_ = e.pool.QueryRow(ctx, `SELECT m.delivery_status::text, j.status::text, length(j.raw_mime) FROM message m JOIN send_job j ON j.message_id = m.id`).
		Scan(&status, &jobStatus, &rawLen)
	if status != "sent" || jobStatus != "sent" || rawLen != 0 {
		t.Fatalf("after send: %s %s raw=%d", status, jobStatus, rawLen)
	}
	if got := e.rec.Types(); len(got) != 1 || got[0] != "email.sent" {
		t.Fatalf("events = %v", got)
	}
}

func TestQueueGivesUpAndCancel(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	e.ses.SendErr = errors.New("down")
	res, _ := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("a@b.test")})
	_, _ = e.pool.Exec(ctx, `UPDATE send_job SET max_attempts = 2`)
	e.now = e.now.Add(time.Hour)
	_, _ = e.s.ProcessOne(ctx)
	var status string
	_ = e.pool.QueryRow(ctx, `SELECT delivery_status::text FROM message WHERE id = $1`, res.ID).Scan(&status)
	if status != "failed" || e.rec.Types()[0] != "email.failed" {
		t.Fatalf("status = %s, events = %v", status, e.rec.Types())
	}
	if err := e.s.Cancel(ctx, nil, res.ID); code(err) != 409 {
		t.Fatalf("cancel after failure: %v", err)
	}

	res, _ = e.s.Send(ctx, send.Input{From: "me@a.test", To: to("a@b.test")})
	if err := e.s.Cancel(ctx, []string{"mbx_x"}, res.ID); code(err) != 404 {
		t.Fatalf("cancel out of reach: %v", err)
	}
	if err := e.s.Cancel(ctx, nil, res.ID); err != nil {
		t.Fatal(err)
	}
	_ = e.pool.QueryRow(ctx, `SELECT delivery_status::text FROM message WHERE id = $1`, res.ID).Scan(&status)
	if status != "canceled" {
		t.Fatalf("status = %s", status)
	}
	e.now = e.now.Add(24 * time.Hour)
	if worked, _ := e.s.ProcessOne(ctx); worked {
		t.Fatal("canceled job ran")
	}
}

func TestStagedAndForwardedFiles(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	m := &mail.Service{DB: e.pool, Store: e.store}
	staged, err := m.Stage(ctx, "a.txt", "text/plain", strings.NewReader("AAA"))
	if err != nil {
		t.Fatal(err)
	}
	first, err := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("x@b.test"), Text: "see file", AttachmentIDs: []string{staged.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(e.ses.Sent[0].Raw, []byte("a.txt")) {
		t.Fatal("file not in message")
	}
	var owner string
	_ = e.pool.QueryRow(ctx, `SELECT message_id FROM attachment WHERE id = $1`, staged.ID).Scan(&owner)
	if owner != first.ID {
		t.Fatalf("staged file belongs to %q", owner)
	}
	// Forwarding the file makes its own stored copy.
	if _, err := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("y@b.test"), Text: "fwd", AttachmentIDs: []string{staged.ID}}); err != nil {
		t.Fatal(err)
	}
	var files, keys int
	_ = e.pool.QueryRow(ctx, `SELECT count(*), count(DISTINCT r2_key) FROM attachment`).Scan(&files, &keys)
	if files != 2 || keys != 2 {
		t.Fatalf("files=%d keys=%d", files, keys)
	}
	if _, err := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("y@b.test"), AttachmentIDs: []string{"att_missing"}}); code(err) != 422 {
		t.Fatalf("missing file: %v", err)
	}
	if _, err := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("y@b.test"), Attachments: []send.Upload{{Filename: "b.txt", Content: "data:text/plain;base64,QkJC"}}}); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(e.ses.Sent[2].Raw, []byte("QkJC")) {
		t.Fatal("inline upload not in message")
	}
}

func TestDraftThenSend(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	d, err := e.s.SaveDraft(ctx, send.Input{From: "me@a.test", Subject: "Draft", Text: "v1"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.SaveDraft(ctx, send.Input{From: "me@a.test", To: to("a@b.test"), Subject: "Draft", Text: "v2", DraftID: d.ID}); err != nil {
		t.Fatal(err)
	}
	var folders string
	_ = e.pool.QueryRow(ctx, `SELECT array_to_string(folders, ',') FROM thread WHERE id = $1`, d.ThreadID).Scan(&folders)
	if folders != "drafts" {
		t.Fatalf("draft folders = %s", folders)
	}
	res, err := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("a@b.test"), Subject: "Draft", Text: "v2", DraftID: d.ID})
	if err != nil || res.ID != d.ID || res.ThreadID != d.ThreadID {
		t.Fatalf("send draft: %+v %v", res, err)
	}
	_ = e.pool.QueryRow(ctx, `SELECT array_to_string(folders, ',') FROM thread WHERE id = $1`, d.ThreadID).Scan(&folders)
	if folders != "sent" {
		t.Fatalf("after send folders = %s", folders)
	}
	if err := e.s.DeleteDraft(ctx, nil, d.ID); code(err) != 404 {
		t.Fatalf("deleting a sent message as a draft: %v", err)
	}
	d2, _ := e.s.SaveDraft(ctx, send.Input{From: "me@a.test", Text: "bin me"})
	if err := e.s.DeleteDraft(ctx, nil, d2.ID); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = e.pool.QueryRow(ctx, `SELECT count(*) FROM thread WHERE id = $1`, d2.ThreadID).Scan(&n)
	if n != 0 {
		t.Fatal("empty draft thread kept")
	}
}

func TestReplyToReceivedMail(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	_, err := e.pool.Exec(ctx, `
		INSERT INTO thread (id, mailbox_id, subject) VALUES ('thr_1', 'mbx_1', 'Question');
		INSERT INTO message (id, thread_id, mailbox_id, rfc_message_id, "references", from_name, from_address, to_addrs, cc_addrs, reply_to, subject, html_body)
		VALUES ('msg_in', 'thr_1', 'mbx_1', '<q@b.test>', '{<root@b.test>}', 'Ada', 'ada@b.test',
			'[{"name":null,"address":"me@a.test"},{"name":null,"address":"bob@b.test"}]', '[{"name":null,"address":"cc@b.test"}]',
			'Help <help@b.test>', 'Question', '<p>hi</p><script>x()</script>');`)
	if err != nil {
		t.Fatal(err)
	}
	res, err := e.s.Reply(ctx, "thr_1", send.ReplyInput{Text: "Answer", ReplyAll: true})
	if err != nil {
		t.Fatal(err)
	}
	if res.ThreadID != "thr_1" || res.Subject != "Re: Question" || strings.Join(res.To, ",") != "help@b.test" {
		t.Fatalf("reply = %+v", res)
	}
	raw := string(e.ses.Sent[0].Raw)
	for _, want := range []string{"In-Reply-To: <q@b.test>", "<root@b.test> <q@b.test>", "bob@b.test", "cc@b.test", "gmail_quote"} {
		if !strings.Contains(raw, want) {
			t.Errorf("reply missing %q", want)
		}
	}
	if strings.Contains(raw, "<script>") {
		t.Error("quoted script travelled onward")
	}
	if strings.Contains(strings.ToLower(raw), "cc: me@a.test") {
		t.Error("replied to ourselves")
	}
}

func TestBackoff(t *testing.T) {
	for attempt, want := range map[int]time.Duration{1: 30 * time.Second, 2: time.Minute, 6: 15 * time.Minute, 40: 15 * time.Minute} {
		got := send.Backoff(attempt)
		if got < want*8/10 || got > want*12/10 {
			t.Errorf("Backoff(%d) = %v, want about %v", attempt, got, want)
		}
	}
}

func TestDraftSentOnceUnderRace(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	d, _ := e.s.SaveDraft(ctx, send.Input{From: "me@a.test", To: to("a@b.test"), Text: "once"})
	errs := make(chan error, 2)
	for range 2 {
		go func() {
			_, err := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("a@b.test"), Text: "once", DraftID: d.ID})
			errs <- err
		}()
	}
	var failed int
	for range 2 {
		if err := <-errs; err != nil {
			if code(err) != 409 {
				t.Fatalf("unexpected: %v", err)
			}
			failed++
		}
	}
	if failed != 1 || e.ses.SentCount() != 1 {
		t.Fatalf("failed=%d sent=%d", failed, e.ses.SentCount())
	}
}

func TestRefusedDraftStaysADraft(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	d, _ := e.s.SaveDraft(ctx, send.Input{From: "me@a.test", To: to("a@b.test"), Text: "x"})
	e.ses.SendErr = &types.MessageRejected{Message: new(string)}
	if _, err := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("a@b.test"), Text: "x", DraftID: d.ID}); code(err) != 422 {
		t.Fatalf("refused: %v", err)
	}
	var isDraft bool
	_ = e.pool.QueryRow(ctx, `SELECT is_draft FROM message WHERE id = $1`, d.ID).Scan(&isDraft)
	if !isDraft {
		t.Fatal("refused send left the draft claimed")
	}
}

func TestDraftFileListIsAuthoritative(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	m := &mail.Service{DB: e.pool, Store: e.store}
	a, _ := m.Stage(ctx, "keep.txt", "text/plain", strings.NewReader("K"))
	b, _ := m.Stage(ctx, "drop.txt", "text/plain", strings.NewReader("D"))
	d, err := e.s.SaveDraft(ctx, send.Input{From: "me@a.test", Text: "x", AttachmentIDs: []string{a.ID, b.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.SaveDraft(ctx, send.Input{From: "me@a.test", Text: "x", DraftID: d.ID, AttachmentIDs: []string{a.ID}}); err != nil {
		t.Fatal(err)
	}
	if e.store.Has(b.R2Key) {
		t.Fatal("removed file still stored")
	}
	if _, err := e.s.Send(ctx, send.Input{From: "me@a.test", To: to("x@b.test"), Text: "x", DraftID: d.ID, AttachmentIDs: []string{a.ID}}); err != nil {
		t.Fatal(err)
	}
	raw := string(e.ses.Sent[0].Raw)
	if !strings.Contains(raw, "keep.txt") || strings.Contains(raw, "drop.txt") {
		t.Fatal("sent files do not match the list")
	}
}
