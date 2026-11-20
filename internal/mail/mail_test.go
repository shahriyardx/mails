package mail_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/inbound"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/page"
	"github.com/shahriyardx/mails/internal/realtime"
	"github.com/shahriyardx/mails/internal/storage"
)

type env struct {
	s     *mail.Service
	in    *inbound.Service
	pool  *pgxpool.Pool
	store *storage.Memory
	t0    time.Time
	n     int
}

func setup(t *testing.T) *env {
	t.Helper()
	pool := dbtest.New(t)
	_, err := pool.Exec(context.Background(), `
		INSERT INTO domain (id, name, region, status, sending_enabled) VALUES ('dom_a', 'a.test', 'us-east-1', 'verified', true);
		INSERT INTO mailbox (id, address, domain, domain_id, display_name) VALUES
			('mbx_1', 'one@a.test', 'a.test', 'dom_a', 'One'), ('mbx_2', 'two@a.test', 'a.test', 'dom_a', 'Two');`)
	if err != nil {
		t.Fatal(err)
	}
	store := storage.NewMemory()
	hub := realtime.NewHub()
	t0 := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	e := &env{pool: pool, store: store, t0: t0,
		s: &mail.Service{DB: pool, Store: store, Hub: hub}}
	e.in = &inbound.Service{DB: pool, Hub: hub, Now: func() time.Time { return t0.Add(time.Duration(e.n) * time.Minute) }}
	return e
}

// receive stores one inbound message and returns its thread id.
func (e *env) receive(t *testing.T, to, from, subject string, files ...inbound.Attachment) string {
	t.Helper()
	e.n++
	text := "body about " + subject
	res, err := e.in.Ingest(context.Background(), &inbound.Payload{
		To: to, From: addr.Address{Address: from}, ToAddresses: []addr.Address{{Address: to}},
		Subject: subject, Text: &text,
	}, files)
	if err != nil || len(res.Stored) != 1 {
		t.Fatalf("receive: %+v %v", res, err)
	}
	var threadID string
	_ = e.pool.QueryRow(context.Background(), `SELECT thread_id FROM message WHERE id = $1`, res.Stored[0]).Scan(&threadID)
	return threadID
}

// sent adds an outbound message to a thread, as the send path will.
func (e *env) sent(t *testing.T, threadID string) {
	t.Helper()
	ctx := context.Background()
	_, err := e.pool.Exec(ctx, `INSERT INTO message (id, thread_id, mailbox_id, from_address, subject, folder, is_outbound, is_read, received_at)
		SELECT 'msg_out_' || $1, $1, mailbox_id, 'one@a.test', subject, 'sent', true, true, last_message_at + interval '1 second' FROM thread WHERE id = $1`, threadID)
	if err != nil {
		t.Fatal(err)
	}
	if err := mail.Recompute(ctx, e.pool, threadID); err != nil {
		t.Fatal(err)
	}
}

func code(err error) int {
	var e *httpx.Error
	if errors.As(err, &e) {
		return e.Status
	}
	return 0
}

func ptr[T any](v T) *T { return &v }

func ids(l page.List[*mail.Thread]) []string {
	out := make([]string, len(l.Data))
	for i, t := range l.Data {
		out[i] = t.ID
	}
	return out
}

func TestListThreadsFiltersAndPages(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	a := e.receive(t, "one@a.test", "x@out.test", "Alpha")
	b := e.receive(t, "one@a.test", "y@out.test", "Beta invoice")
	c := e.receive(t, "two@a.test", "x@out.test", "Gamma")

	list := func(f mail.ThreadFilter) []string {
		t.Helper()
		if f.Page.Limit == 0 {
			f.Page.Limit = 25
		}
		l, err := e.s.ListThreads(ctx, f)
		if err != nil {
			t.Fatal(err)
		}
		return ids(l)
	}
	if got := list(mail.ThreadFilter{Folder: "inbox"}); strings.Join(got, ",") != c+","+b+","+a {
		t.Fatalf("inbox order = %v", got)
	}
	if got := list(mail.ThreadFilter{MailboxID: "two@a.test"}); len(got) != 1 || got[0] != c {
		t.Fatalf("by mailbox = %v", got)
	}
	if got := list(mail.ThreadFilter{Allowed: []string{"mbx_1"}}); len(got) != 2 {
		t.Fatalf("allowed = %v", got)
	}
	if got := list(mail.ThreadFilter{Query: "invoice"}); len(got) != 1 || got[0] != b {
		t.Fatalf("search = %v", got)
	}
	if got := list(mail.ThreadFilter{Participant: "X@out.test"}); len(got) != 2 {
		t.Fatalf("participant = %v", got)
	}
	if _, err := e.s.ListThreads(ctx, mail.ThreadFilter{Folder: "bogus"}); code(err) != 422 {
		t.Fatalf("bad folder: %v", err)
	}

	// Paging two at a time walks all three exactly once.
	p1, _ := e.s.ListThreads(ctx, mail.ThreadFilter{Page: page.Params{Limit: 2}})
	if !p1.HasMore || len(p1.Data) != 2 {
		t.Fatalf("page 1 = %+v", p1)
	}
	q, _ := page.Parse(map[string][]string{"cursor": {*p1.NextCursor}, "limit": {"2"}})
	p2, _ := e.s.ListThreads(ctx, mail.ThreadFilter{Page: q})
	if p2.HasMore || len(p2.Data) != 1 || p2.Data[0].ID != a {
		t.Fatalf("page 2 = %+v", ids(p2))
	}
}

func TestMoveRules(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	th := e.receive(t, "one@a.test", "x@out.test", "Hello")
	e.sent(t, th)

	folders := func() string {
		var f string
		_ = e.pool.QueryRow(ctx, `SELECT array_to_string(folders, ',') FROM thread WHERE id = $1`, th).Scan(&f)
		return f
	}
	if folders() != "inbox,sent" {
		t.Fatalf("start = %s", folders())
	}
	// Archive moves received mail; our reply stays in sent.
	if _, err := e.s.ChangeThreads(ctx, nil, []string{th}, mail.ThreadChange{Folder: ptr("archive")}); err != nil {
		t.Fatal(err)
	}
	// Folders come back in enum order.
	if folders() != "sent,archive" {
		t.Fatalf("archived = %s", folders())
	}
	// Trash takes everything; restore puts each back where it was.
	if _, err := e.s.DeleteThreads(ctx, nil, []string{th}, false); err != nil {
		t.Fatal(err)
	}
	if folders() != "trash" {
		t.Fatalf("trashed = %s", folders())
	}
	if _, err := e.s.RestoreThreads(ctx, nil, []string{th}); err != nil {
		t.Fatal(err)
	}
	if folders() != "sent,archive" {
		t.Fatalf("restored = %s", folders())
	}
	// Back to inbox: received to inbox, ours to sent.
	if _, err := e.s.ChangeThreads(ctx, nil, []string{th}, mail.ThreadChange{Folder: ptr("inbox")}); err != nil {
		t.Fatal(err)
	}
	if folders() != "inbox,sent" {
		t.Fatalf("inbox again = %s", folders())
	}
	if _, err := e.s.ChangeThreads(ctx, nil, []string{th}, mail.ThreadChange{Folder: ptr("sent")}); code(err) != 422 {
		t.Fatalf("move to sent: %v", err)
	}
	// Out of reach is a 404.
	if _, err := e.s.ChangeThreads(ctx, []string{"mbx_2"}, []string{th}, mail.ThreadChange{IsRead: ptr(true)}); code(err) != 404 {
		t.Fatalf("out of reach: %v", err)
	}
}

func TestReadStarLabels(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	th := e.receive(t, "one@a.test", "x@out.test", "Hello")
	if _, err := e.s.CreateLabel(ctx, mail.LabelInput{Name: "Work"}); err != nil {
		t.Fatal(err)
	}

	// An unknown label fails the whole change.
	_, err := e.s.ChangeThreads(ctx, nil, []string{th}, mail.ThreadChange{IsRead: ptr(true), AddLabels: []string{"Work", "Nope"}})
	if code(err) != 422 {
		t.Fatalf("unknown label: %v", err)
	}
	got, _ := e.s.GetThread(ctx, nil, th, false)
	if got.UnreadCount != 1 || len(got.Labels) != 0 {
		t.Fatalf("partial write: %+v", got)
	}

	if _, err := e.s.ChangeThreads(ctx, nil, []string{th}, mail.ThreadChange{IsRead: ptr(true), IsStarred: ptr(true), AddLabels: []string{"work"}}); err != nil {
		t.Fatal(err)
	}
	got, _ = e.s.GetThread(ctx, nil, th, true)
	if got.UnreadCount != 0 || !got.IsStarred || len(got.Labels) != 1 || got.Labels[0].Name != "Work" {
		t.Fatalf("after change: %+v", got)
	}
	if got.Messages[0].Text == nil || got.Messages[0].Direction != "inbound" {
		t.Fatalf("message = %+v", got.Messages[0])
	}
	l, _ := e.s.ListThreads(ctx, mail.ThreadFilter{Folder: "starred", Label: "Work", Page: page.Params{Limit: 10}})
	if len(l.Data) != 1 {
		t.Fatalf("starred+label = %d", len(l.Data))
	}
	if _, err := e.s.ChangeThreads(ctx, nil, []string{th}, mail.ThreadChange{IsStarred: ptr(false), RemoveLabels: []string{got.Labels[0].ID}}); err != nil {
		t.Fatal(err)
	}
	got, _ = e.s.GetThread(ctx, nil, th, false)
	if got.IsStarred || len(got.Labels) != 0 {
		t.Fatalf("after undo: %+v", got)
	}
}

func TestDeletePurgesAndForgetsFiles(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	_ = e.store.Put(ctx, "inbound/k/0-a.pdf", strings.NewReader("pdf"), "application/pdf")
	th := e.receive(t, "one@a.test", "x@out.test", "Files",
		inbound.Attachment{Filename: "a.pdf", ContentType: "application/pdf", SizeBytes: 3, R2Key: "inbound/k/0-a.pdf"})

	out, err := e.s.DeleteThreads(ctx, nil, []string{th}, false)
	if err != nil || out[0].Permanent {
		t.Fatalf("first delete: %+v %v", out, err)
	}
	out, err = e.s.DeleteThreads(ctx, nil, []string{th}, false)
	if err != nil || !out[0].Permanent {
		t.Fatalf("second delete: %+v %v", out, err)
	}
	if _, err := e.s.GetThread(ctx, nil, th, false); code(err) != 404 {
		t.Fatalf("thread still there: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for e.store.Has("inbound/k/0-a.pdf") && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if e.store.Has("inbound/k/0-a.pdf") {
		t.Fatal("stored file not deleted")
	}
}

func TestEmptyTrashAndCounts(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	a := e.receive(t, "one@a.test", "x@out.test", "A")
	e.receive(t, "one@a.test", "x@out.test", "B")
	c := e.receive(t, "two@a.test", "x@out.test", "C")
	_, _ = e.s.DeleteThreads(ctx, nil, []string{a, c}, false)

	counts, err := e.s.Counts(ctx, nil, "", "")
	if err != nil || counts.Folders["inbox"] != 1 || counts.Folders["trash"] != 2 || counts.Mailboxes["mbx_1"] != 1 {
		t.Fatalf("counts = %+v %v", counts, err)
	}
	n, err := e.s.EmptyTrash(ctx, nil, "one@a.test", "")
	if err != nil || n != 1 {
		t.Fatalf("empty trash = %d %v", n, err)
	}
	var left int
	_ = e.pool.QueryRow(ctx, `SELECT count(*) FROM thread`).Scan(&left)
	if left != 2 {
		t.Fatalf("threads left = %d, want 2", left)
	}
}

func TestAttachmentsReachOnlyThroughMessages(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	staged, err := e.s.Stage(ctx, "note.txt", "text/plain", strings.NewReader("hi"))
	if err != nil || staged.SizeBytes != 2 {
		t.Fatalf("stage: %+v %v", staged, err)
	}
	if _, err := e.s.GetAttachment(ctx, nil, staged.ID); code(err) != 404 {
		t.Fatalf("staged reachable: %v", err)
	}
	th := e.receive(t, "one@a.test", "x@out.test", "F", inbound.Attachment{Filename: "f.txt", R2Key: "inbound/f"})
	got, _ := e.s.GetThread(ctx, nil, th, false)
	att := got.Messages[0].Attachments[0]
	if _, err := e.s.GetAttachment(ctx, []string{"mbx_2"}, att.ID); code(err) != 404 {
		t.Fatalf("other mailbox reachable: %v", err)
	}
	if a, err := e.s.GetAttachment(ctx, []string{"mbx_1"}, att.ID); err != nil || a.ContentType != "application/octet-stream" {
		t.Fatalf("own mailbox: %+v %v", a, err)
	}
	big := strings.NewReader(strings.Repeat("x", mail.MaxUpload+1))
	if _, err := e.s.Stage(ctx, "big.bin", "", big); code(err) != 413 {
		t.Fatalf("too big: %v", err)
	}
}

func TestLabelsFiltersContactsPrefs(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	if _, err := e.s.CreateLabel(ctx, mail.LabelInput{Name: "A", Color: "red"}); code(err) != 422 {
		t.Fatalf("bad color: %v", err)
	}
	l, _ := e.s.CreateLabel(ctx, mail.LabelInput{Name: "A"})
	if _, err := e.s.CreateLabel(ctx, mail.LabelInput{Name: "a"}); code(err) != 409 {
		t.Fatalf("duplicate (case-insensitive name lookup): %v", err)
	}
	if l2, err := e.s.UpdateLabel(ctx, "A", mail.LabelInput{Color: "#112233"}); err != nil || l2.Name != "A" || l2.Color != "#112233" {
		t.Fatalf("update: %+v %v", l2, err)
	}

	if _, err := e.s.SaveFilter(ctx, mail.Filter{Name: "empty"}); code(err) != 422 {
		t.Fatalf("filter without condition: %v", err)
	}
	f, err := e.s.SaveFilter(ctx, mail.Filter{Name: "f", Enabled: true, MatchFrom: ptr("x@"), ActionLabelID: ptr("A")})
	if err != nil || *f.ActionLabelID != l.ID {
		t.Fatalf("filter: %+v %v", f, err)
	}

	e.receive(t, "one@a.test", "x@out.test", "1")
	e.receive(t, "one@a.test", "x@out.test", "2")
	e.receive(t, "one@a.test", "y@out.test", "3")
	c, err := e.s.ListContacts(ctx, "", "frequent", page.Params{Limit: 1})
	if err != nil || c.Data[0].Address != "x@out.test" || !c.HasMore {
		t.Fatalf("contacts: %+v %v", c, err)
	}

	var uid string
	_ = e.pool.QueryRow(ctx, `INSERT INTO app_user (id, github_id, login, name, email) VALUES ('usr_1', 1, 'o', 'O', 'o@x') RETURNING id`).Scan(&uid)
	p, err := e.s.SavePreferences(ctx, uid, mail.Preferences{Density: "compact"})
	if err != nil || p.Density != "compact" || p.ReadingLayout != "split" {
		t.Fatalf("prefs: %+v %v", p, err)
	}
	if p, _ = e.s.SavePreferences(ctx, uid, mail.Preferences{NavCollapsed: ptr(true)}); p.Density != "compact" || !*p.NavCollapsed {
		t.Fatalf("merge: %+v", p)
	}
	if p, _ = e.s.SavePreferences(ctx, uid, mail.Preferences{Theme: "light"}); p.Theme != "light" || p.Density != "compact" {
		t.Fatalf("theme: %+v", p)
	}
	if _, err := e.s.SavePreferences(ctx, uid, mail.Preferences{Theme: "neon"}); code(err) != 422 {
		t.Fatalf("bad theme accepted")
	}
	if _, err := e.s.SavePreferences(ctx, uid, mail.Preferences{Density: "huge"}); code(err) != 422 {
		t.Fatalf("bad density: %v", err)
	}

	if err := e.s.TrustImages(ctx, "News@x.test", true); err != nil {
		t.Fatal(err)
	}
	m, _ := e.s.ImageChoices(ctx, []string{"news@x.test", "other@x.test"})
	if len(m) != 1 || !m["news@x.test"] {
		t.Fatalf("image choices = %v", m)
	}
}

// The sender of the first message comes first in participants even when
// your own address sorts before theirs (one@ < zed@).
func TestParticipantsStartWithSender(t *testing.T) {
	e := setup(t)
	threadID := e.receive(t, "one@a.test", "zed@b.test", "Hello")
	var first string
	if err := e.pool.QueryRow(context.Background(), `SELECT participants->0->>'address' FROM thread WHERE id = $1`, threadID).Scan(&first); err != nil {
		t.Fatal(err)
	}
	if first != "zed@b.test" {
		t.Fatalf("participants[0] = %s, want the sender", first)
	}
}
