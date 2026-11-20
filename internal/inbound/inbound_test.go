package inbound_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/inbound"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/realtime"
)

var now = time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)

func setup(t *testing.T) (*inbound.Service, *pgxpool.Pool, *[]inbound.Received) {
	t.Helper()
	pool := dbtest.New(t)
	_, err := pool.Exec(context.Background(), `
		INSERT INTO domain (id, name, region, status, sending_enabled) VALUES
			('dom_a', 'a.test', 'us-east-1', 'verified', true),
			('dom_auto', 'auto.test', 'us-east-1', 'verified', true);
		UPDATE domain SET auto_create_mailboxes = true WHERE id = 'dom_auto';
		INSERT INTO mailbox (id, address, domain, domain_id, display_name) VALUES
			('mbx_hi', 'hi@a.test', 'a.test', 'dom_a', 'Hi');`)
	if err != nil {
		t.Fatal(err)
	}
	var got []inbound.Received
	s := &inbound.Service{DB: pool, Hub: realtime.NewHub(), Now: func() time.Time { return now },
		OnReceived: []func(context.Context, inbound.Received){func(_ context.Context, r inbound.Received) { got = append(got, r) }}}
	return s, pool, &got
}

func ptr[T any](v T) *T { return &v }

func msg(to, messageID, subject string) *inbound.Payload {
	p := &inbound.Payload{
		To: to, Recipients: []string{to},
		From:        addr.Address{Name: "Ada", Address: "Ada@Sender.test"},
		ToAddresses: []addr.Address{{Address: to}},
		Subject:     subject, Text: ptr("hello there"),
		Date: ptr(now.Add(-time.Hour).Format(time.RFC3339)),
	}
	if messageID != "" {
		p.MessageID = &messageID
	}
	return p
}

func TestIngestThreadsAndDedupes(t *testing.T) {
	s, pool, hooks := setup(t)
	ctx := context.Background()

	res, err := s.Ingest(ctx, msg("hi@a.test", "<1@sender.test>", "Order 42"),
		[]inbound.Attachment{{Filename: "a.pdf", ContentType: "application/pdf", SizeBytes: 10, R2Key: "inbound/x/0-a.pdf"}})
	if err != nil || len(res.Stored) != 1 {
		t.Fatalf("first: %+v %v", res, err)
	}
	// Same Message-ID again: nothing new, no hook, same id reported.
	again, err := s.Ingest(ctx, msg("hi@a.test", "<1@sender.test>", "Order 42"), nil)
	if err != nil || again.Stored[0] != res.Stored[0] || len(*hooks) != 1 {
		t.Fatalf("dup: %+v %v hooks=%d", again, err, len(*hooks))
	}

	// A reply by In-Reply-To joins the thread even with another subject.
	reply := msg("hi@a.test", "<2@sender.test>", "different")
	reply.InReplyTo = ptr("<1@sender.test>")
	if _, err := s.Ingest(ctx, reply, nil); err != nil {
		t.Fatal(err)
	}
	// "Re: Order 42" joins by subject.
	if _, err := s.Ingest(ctx, msg("hi@a.test", "<3@sender.test>", "Re: Order 42"), nil); err != nil {
		t.Fatal(err)
	}

	var threads, count, unread int
	var hasAtt bool
	var participants string
	err = pool.QueryRow(ctx, `SELECT count(*) OVER (), message_count, unread_count, has_attachments, participants::text FROM thread`).
		Scan(&threads, &count, &unread, &hasAtt, &participants)
	if err != nil || threads != 1 || count != 3 || unread != 3 || !hasAtt {
		t.Fatalf("thread: n=%d count=%d unread=%d att=%v err=%v", threads, count, unread, hasAtt, err)
	}
	if participants != `[{"name": "Ada", "address": "ada@sender.test"}, {"name": null, "address": "hi@a.test"}]` {
		t.Fatalf("participants = %s", participants)
	}
	var seen int
	_ = pool.QueryRow(ctx, `SELECT message_count FROM contact WHERE address = 'ada@sender.test'`).Scan(&seen)
	if seen != 3 {
		t.Fatalf("contact count = %d", seen)
	}
}

func TestReplyToOurSentMailThreadsBySESID(t *testing.T) {
	// SES's Message-ID host is email.amazonses.com in us-east-1 and
	// <region>.amazonses.com elsewhere.
	for _, ref := range []string{"<0100abc@email.amazonses.com>", "<0100abc@eu-west-1.amazonses.com>"} {
		t.Run(ref, func(t *testing.T) {
			s, pool, _ := setup(t)
			ctx := context.Background()
			_, err := pool.Exec(ctx, `
		INSERT INTO thread (id, mailbox_id, subject) VALUES ('thr_sent', 'mbx_hi', 'Quote');
		INSERT INTO message (id, thread_id, mailbox_id, from_address, to_addrs, subject, folder, is_outbound, is_read, ses_message_id, rfc_message_id)
			VALUES ('msg_sent', 'thr_sent', 'mbx_hi', 'hi@a.test', '[{"name":null,"address":"ada@sender.test"}]', 'Quote', 'sent', true, true, '0100abc', '<ours@a.test>');`)
			if err != nil {
				t.Fatal(err)
			}
			if err := mail.Recompute(ctx, pool, "thr_sent"); err != nil {
				t.Fatal(err)
			}
			p := msg("hi@a.test", "<r@sender.test>", "unrelated")
			p.References = []string{ref}
			if _, err := s.Ingest(ctx, p, nil); err != nil {
				t.Fatal(err)
			}
			var folders string
			_ = pool.QueryRow(ctx, `SELECT folders::text FROM thread WHERE id = 'thr_sent'`).Scan(&folders)
			if folders != "{inbox,sent}" {
				t.Fatalf("folders = %s", folders)
			}
		})
	}
}

func TestStrangerCannotJoinThread(t *testing.T) {
	s, pool, _ := setup(t)
	ctx := context.Background()
	if _, err := s.Ingest(ctx, msg("hi@a.test", "<1@sender.test>", "Invoice 7"), nil); err != nil {
		t.Fatal(err)
	}
	// Same subject from someone else: a new thread.
	copycat := msg("hi@a.test", "<x@evil.test>", "Re: Invoice 7")
	copycat.From = addr.Address{Address: "mallory@evil.test"}
	// A leaked Message-ID with a different subject: a new thread too.
	leaked := msg("hi@a.test", "<y@evil.test>", "Click here")
	leaked.From = addr.Address{Address: "mallory@evil.test"}
	leaked.InReplyTo = ptr("<1@sender.test>")
	// A leaked Message-ID with the matching subject is a real reply from a
	// new participant (someone cc'd later), so it joins.
	cc := msg("hi@a.test", "<z@other.test>", "Re: Invoice 7")
	cc.From = addr.Address{Address: "colleague@other.test"}
	cc.References = []string{"<1@sender.test>"}
	for _, p := range []*inbound.Payload{copycat, leaked, cc} {
		if _, err := s.Ingest(ctx, p, nil); err != nil {
			t.Fatal(err)
		}
	}
	var threads int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM thread`).Scan(&threads)
	if threads != 3 {
		t.Fatalf("threads = %d, want 3 (original+cc, copycat, leaked)", threads)
	}
}

func TestRouting(t *testing.T) {
	s, pool, _ := setup(t)
	ctx := context.Background()

	// Unknown address on a domain without auto-create: not stored.
	if res, err := s.Ingest(ctx, msg("nobody@a.test", "", "x"), nil); err != nil || len(res.Stored) != 0 {
		t.Fatalf("unknown: %+v %v", res, err)
	}
	// Auto-create domain: a mailbox appears.
	if res, err := s.Ingest(ctx, msg("new@auto.test", "", "x"), nil); err != nil || len(res.Stored) != 1 {
		t.Fatalf("auto: %+v %v", res, err)
	}
	// ...and on a subdomain it covers, filed under it.
	res, err := s.Ingest(ctx, msg("new@sub.auto.test", "", "x"), nil)
	if err != nil || len(res.Stored) != 1 {
		t.Fatalf("auto on subdomain: %+v %v", res, err)
	}
	var domainID string
	_ = pool.QueryRow(ctx, `SELECT domain_id FROM mailbox WHERE address = 'new@sub.auto.test'`).Scan(&domainID)
	if domainID != "dom_auto" {
		t.Fatalf("auto-created mailbox domain = %q", domainID)
	}
	// A closer domain without auto-create wins over its parent's.
	if _, err := pool.Exec(ctx, `INSERT INTO domain (id, name, region) VALUES ('dom_off', 'off.auto.test', 'us-east-1')`); err != nil {
		t.Fatal(err)
	}
	if res, err := s.Ingest(ctx, msg("new@off.auto.test", "", "x"), nil); err != nil || len(res.Stored) != 0 {
		t.Fatalf("closer domain without auto-create: %+v %v", res, err)
	}
	// Catch-all takes anything on its domain.
	if _, err := pool.Exec(ctx, `UPDATE mailbox SET is_catch_all = true WHERE id = 'mbx_hi'`); err != nil {
		t.Fatal(err)
	}
	var mbx string
	res, _ = s.Ingest(ctx, msg("random@a.test", "", "x"), nil)
	_ = pool.QueryRow(ctx, `SELECT mailbox_id FROM message WHERE id = $1`, res.Stored[0]).Scan(&mbx)
	if mbx != "mbx_hi" {
		t.Fatalf("catch-all mailbox = %q", mbx)
	}
}

func TestFiltersAndSpam(t *testing.T) {
	s, pool, _ := setup(t)
	ctx := context.Background()
	_, err := pool.Exec(ctx, `
		INSERT INTO label (id, name) VALUES ('lbl_bills', 'Bills');
		INSERT INTO filter_rule (id, name, match_from, match_subject, action_folder, action_label_id, action_mark_read, action_star)
			VALUES ('flt_1', 'bills', 'sender.test', 'INVOICE', 'archive', 'lbl_bills', true, true),
			       ('flt_off', 'off', 'sender.test', NULL, 'trash', NULL, false, false);
		UPDATE filter_rule SET enabled = false WHERE id = 'flt_off';`)
	if err != nil {
		t.Fatal(err)
	}
	res, _ := s.Ingest(ctx, msg("hi@a.test", "", "Your invoice"), nil)
	var folder string
	var read, star bool
	var labels int
	_ = pool.QueryRow(ctx, `SELECT folder::text, is_read, is_starred, (SELECT count(*) FROM thread_label tl WHERE tl.thread_id = m.thread_id)
		FROM message m WHERE id = $1`, res.Stored[0]).Scan(&folder, &read, &star, &labels)
	if folder != "archive" || !read || !star || labels != 1 {
		t.Fatalf("filtered: folder=%s read=%v star=%v labels=%d", folder, read, star, labels)
	}

	spam := msg("hi@a.test", "", "hello")
	spam.Auth.DMARC = ptr("fail")
	res, _ = s.Ingest(ctx, spam, nil)
	_ = pool.QueryRow(ctx, `SELECT folder::text FROM message WHERE id = $1`, res.Stored[0]).Scan(&folder)
	if folder != "spam" {
		t.Fatalf("dmarc fail folder = %s", folder)
	}
}

func TestFutureDateIsClamped(t *testing.T) {
	s, pool, _ := setup(t)
	p := msg("hi@a.test", "", "x")
	p.Date = ptr(now.Add(24 * 365 * time.Hour).Format(time.RFC3339))
	res, _ := s.Ingest(context.Background(), p, nil)
	var at time.Time
	_ = pool.QueryRow(context.Background(), `SELECT received_at FROM message WHERE id = $1`, res.Stored[0]).Scan(&at)
	if !at.Equal(now) {
		t.Fatalf("received_at = %v, want %v", at, now)
	}
}

func TestForwardAnswer(t *testing.T) {
	s, pool, _ := setup(t)
	ctx := context.Background()
	_, err := pool.Exec(ctx, `
		INSERT INTO forward_address (id, address, verified_at) VALUES
			('fwa_1', 'me@gmail.test', now()), ('fwa_2', 'unverified@gmail.test', NULL), ('fwa_loop', 'x@a.test', now());
		INSERT INTO forward_rule (id, address_id, mailbox_id) VALUES ('fwr_1', 'fwa_1', 'mbx_hi'), ('fwr_2', 'fwa_2', 'mbx_hi');
		INSERT INTO forward_rule (id, address_id, domain_id) VALUES ('fwr_3', 'fwa_loop', 'dom_a');`)
	if err != nil {
		t.Fatal(err)
	}
	res, _ := s.Ingest(ctx, msg("hi@a.test", "", "x"), nil)
	if len(res.Forward) != 1 || res.Forward[0] != "me@gmail.test" {
		t.Fatalf("forward = %v (unverified and own-domain targets must be dropped)", res.Forward)
	}
	// Mailbox forward_off stops domain and instance rules, not its own.
	_, _ = pool.Exec(ctx, `INSERT INTO forward_address (id, address, verified_at) VALUES ('fwa_i', 'all@x.test', now());
		INSERT INTO forward_rule (id, address_id) VALUES ('fwr_i', 'fwa_i'); UPDATE mailbox SET forward_off = true`)
	res, _ = s.Ingest(ctx, msg("hi@a.test", "", "y"), nil)
	if len(res.Forward) != 1 || res.Forward[0] != "me@gmail.test" {
		t.Fatalf("forward with stop = %v", res.Forward)
	}
	// Unknown address: domain and instance rules apply.
	res, _ = s.Ingest(ctx, msg("ghost@a.test", "", "z"), nil)
	if len(res.Stored) != 0 || len(res.Forward) != 1 || res.Forward[0] != "all@x.test" {
		t.Fatalf("unknown forward = %+v", res)
	}
	// An unknown address on a subdomain a.test covers follows a.test's
	// rules, like its mailboxes would.
	_, _ = pool.Exec(ctx, `INSERT INTO forward_address (id, address, verified_at) VALUES ('fwa_d', 'dom@x.test', now());
		INSERT INTO forward_rule (id, address_id, domain_id) VALUES ('fwr_d', 'fwa_d', 'dom_a')`)
	res, _ = s.Ingest(ctx, msg("ghost@sub.a.test", "", "z"), nil)
	if len(res.Stored) != 0 || len(res.Forward) != 2 || res.Forward[0] != "all@x.test" || res.Forward[1] != "dom@x.test" {
		t.Fatalf("unknown subdomain forward = %+v", res)
	}
}

func sign(secret, ts string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(ts + "."))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func TestVerify(t *testing.T) {
	body := []byte(`{"x":1}`)
	ts := strconv.FormatInt(now.UnixMilli(), 10)
	old := strconv.FormatInt(now.Add(-6*time.Minute).UnixMilli(), 10)
	tests := []struct {
		name, secret, sig, ts string
		want                  bool
	}{
		{"good", "s3cret", sign("s3cret", ts, body), ts, true},
		{"wrong secret", "s3cret", sign("other", ts, body), ts, false},
		{"stale", "s3cret", sign("s3cret", old, body), old, false},
		{"no secret configured", "", sign("", ts, body), ts, false},
		{"garbage timestamp", "s3cret", sign("s3cret", "abc", body), "abc", false},
	}
	for _, tt := range tests {
		if got := inbound.Verify(tt.secret, body, tt.sig, tt.ts, now); got != tt.want {
			t.Errorf("%s: got %v", tt.name, got)
		}
	}
}

func TestHandler(t *testing.T) {
	s, _, _ := setup(t)
	h := inbound.Handler(s, "s3cret")
	post := func(email *inbound.Payload, sig string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]any{"email": email})
		ts := strconv.FormatInt(now.UnixMilli(), 10)
		if sig == "" {
			sig = sign("s3cret", ts, body)
		}
		req := httptest.NewRequest("POST", "/api/inbound", bytes.NewReader(body))
		req.Header.Set("X-Mail-Signature", sig)
		req.Header.Set("X-Mail-Timestamp", ts)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		return w
	}
	if w := post(msg("hi@a.test", "", "x"), "bad"); w.Code != http.StatusUnauthorized {
		t.Fatalf("bad signature: %d", w.Code)
	}
	if w := post(msg("hi@a.test", "", "x"), ""); w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"stored":1`)) {
		t.Fatalf("stored: %d %s", w.Code, w.Body)
	}
	if w := post(msg("ghost@a.test", "", "x"), ""); w.Code != 202 || !bytes.Contains(w.Body.Bytes(), []byte(`"forward":[]`)) {
		t.Fatalf("unknown: %d %s", w.Code, w.Body)
	}
}

func TestHighestPriorityFilterPicksFolder(t *testing.T) {
	s, pool, _ := setup(t)
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `INSERT INTO filter_rule (id, name, priority, match_from, action_folder) VALUES
		('flt_hi', 'hi', 10, 'sender.test', 'archive'), ('flt_lo', 'lo', 1, 'sender.test', 'trash')`)
	res, _ := s.Ingest(ctx, msg("hi@a.test", "", "x"), nil)
	var folder string
	_ = pool.QueryRow(ctx, `SELECT folder::text FROM message WHERE id = $1`, res.Stored[0]).Scan(&folder)
	if folder != "archive" {
		t.Fatalf("folder = %s, want the high-priority rule's archive", folder)
	}
}

func TestSubjectThreadingTakesBackslashLiterally(t *testing.T) {
	for _, subject := range []string{`Path C:\`, `a\b report`, `100% done_now`} {
		t.Run(subject, func(t *testing.T) {
			s, pool, _ := setup(t)
			ctx := context.Background()
			if _, err := s.Ingest(ctx, msg("hi@a.test", "<1@sender.test>", subject), nil); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Ingest(ctx, msg("hi@a.test", "<2@sender.test>", "Re: "+subject), nil); err != nil {
				t.Fatal(err)
			}
			var threads int
			_ = pool.QueryRow(ctx, `SELECT count(*) FROM thread`).Scan(&threads)
			if threads != 1 {
				t.Fatalf("threads = %d, want 1", threads)
			}
		})
	}
}

// Mail to yourself comes back with the Message-ID its sent copy stores; it
// still lands in the inbox, and a second delivery is still a duplicate.
func TestMailToSelfReachesInbox(t *testing.T) {
	s, pool, _ := setup(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		INSERT INTO thread (id, mailbox_id, subject) VALUES ('thr_self', 'mbx_hi', 'Note to self');
		INSERT INTO message (id, thread_id, mailbox_id, from_address, subject, folder, is_outbound, is_read, rfc_message_id)
			VALUES ('msg_self', 'thr_self', 'mbx_hi', 'hi@a.test', 'Note to self', 'sent', true, true, '<0100self@email.amazonses.com>');`); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := s.Ingest(ctx, msg("hi@a.test", "<0100self@email.amazonses.com>", "Note to self"), nil); err != nil {
			t.Fatal(err)
		}
	}
	var inbox int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM message WHERE mailbox_id = 'mbx_hi' AND folder = 'inbox' AND NOT is_outbound`).Scan(&inbox)
	if inbox != 1 {
		t.Fatalf("inbox copies = %d, want 1", inbox)
	}
}

// Postgres text cannot hold NUL, and any sender can put one in a header
// or body: it is dropped, not a 500 that loses the mail.
func TestNULBytesAreStripped(t *testing.T) {
	s, pool, _ := setup(t)
	ctx := context.Background()
	p := msg("hi@a.test", "<n\x00ul@sender.test>", "hi\x00there")
	p.From.Name = "A\x00da"
	p.ToAddresses[0].Name = "H\x00i"
	p.CcAddresses = []addr.Address{{Name: "C\x00c", Address: "cc@x.test"}}
	p.ReplyTo = ptr("r\x00@sender.test")
	p.Text, p.HTML = ptr("body\x00text"), ptr("<p>body\x00</p>")
	p.InReplyTo, p.References = ptr("<x\x00@y>"), []string{"<x\x00@y>"}
	p.Auth.SPF, p.MailedBy, p.SignedBy, p.TLS = ptr("pa\x00ss"), ptr("s\x00ender.test"), ptr("s\x00ender.test"), ptr("TLS\x001.3")
	cid := "c\x00id"
	res, err := s.Ingest(ctx, p, []inbound.Attachment{{Filename: "a\x00.pdf", ContentType: "application/p\x00df",
		SizeBytes: 1, R2Key: "inbound/x/0-a\x00.pdf", ContentID: &cid}})
	if err != nil || len(res.Stored) != 1 {
		t.Fatalf("ingest: %+v %v", res, err)
	}
	var subject, text, name, file string
	_ = pool.QueryRow(ctx, `SELECT m.subject, m.text_body, m.from_name, a.filename FROM message m
		JOIN attachment a ON a.message_id = m.id WHERE m.id = $1`, res.Stored[0]).Scan(&subject, &text, &name, &file)
	if subject != "hithere" || text != "bodytext" || name != "Ada" || file != "a.pdf" {
		t.Fatalf("stored %q %q %q %q", subject, text, name, file)
	}
}
