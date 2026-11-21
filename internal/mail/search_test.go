package mail_test

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"slices"
	"testing"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/inbound"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/page"
)

// The cases are shared with the dashboard's parser (web/src/lib/search.test.ts).
func TestParseSearch(t *testing.T) {
	raw, err := os.ReadFile("testdata/search.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Q     string      `json:"q"`
		Terms []mail.Term `json:"terms"`
		Text  string      `json:"text"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, c := range cases {
		got := mail.ParseSearch(c.Q)
		if len(got.Terms) == 0 {
			got.Terms = []mail.Term{}
		}
		if !reflect.DeepEqual(got.Terms, c.Terms) || got.Text != c.Text {
			t.Errorf("ParseSearch(%q) = %+v %q, want %+v %q", c.Q, got.Terms, got.Text, c.Terms, c.Text)
		}
	}
}

func TestSearchFilters(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	text := func(s string) *string { return &s }
	ingest := func(p inbound.Payload, files ...inbound.Attachment) string {
		t.Helper()
		e.n++
		res, err := e.in.Ingest(ctx, &p, files)
		if err != nil || len(res.Stored) != 1 {
			t.Fatalf("ingest: %+v %v", res, err)
		}
		var id string
		_ = e.pool.QueryRow(ctx, `SELECT thread_id FROM message WHERE id = $1`, res.Stored[0]).Scan(&id)
		return id
	}
	me := []addr.Address{{Address: "one@a.test"}}
	a := ingest(inbound.Payload{To: "one@a.test", From: addr.Address{Name: "Ada Lovelace", Address: "ada@out.test"}, ToAddresses: me,
		Subject: "Q3 plan", Text: text("numbers inside")}, inbound.Attachment{Filename: "plan.pdf", ContentType: "application/pdf", SizeBytes: 3, R2Key: "k1"})
	b := ingest(inbound.Payload{To: "one@a.test", From: addr.Address{Address: "bob@out.test"}, ToAddresses: me,
		Subject: "Lunch", Text: text("pizza at noon")})
	c := ingest(inbound.Payload{To: "one@a.test", From: addr.Address{Address: "carol@out.test"}, ToAddresses: me,
		CcAddresses: []addr.Address{{Name: "Dave", Address: "dave@x.test"}}, Subject: "Trip", Text: text("tickets")})
	if _, err := e.s.ChangeThreads(ctx, nil, []string{b}, mail.ThreadChange{IsRead: ptr(true), IsStarred: ptr(true), Folder: ptr("archive")}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.CreateLabel(ctx, mail.LabelInput{Name: "Work"}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.s.ChangeThreads(ctx, nil, []string{a}, mail.ThreadChange{AddLabels: []string{"work"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `UPDATE message SET received_at = '2026-11-05T10:00:00Z' WHERE thread_id = $1`, c); err != nil {
		t.Fatal(err)
	}
	if err := mail.Recompute(ctx, e.pool, c); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		q      string
		folder string
		want   []string
	}{
		{"from:ada", "", []string{a}},
		{`from:"Ada L"`, "", []string{a}},
		{"from:LOVELACE", "", []string{a}},
		{"to:dave", "", []string{c}},
		{"to:address", "", nil}, // JSON keys are not searched
		{`subject:"q3 plan"`, "", []string{a}},
		{"has:attachment", "", []string{a}},
		{"is:unread", "", []string{c, a}},
		{"is:read", "", []string{b}},
		{"is:starred", "", []string{b}},
		{"label:work", "", []string{a}},
		{"in:archive", "inbox", []string{b}},
		{"lunch", "inbox", nil},
		{"after:2026-11-02", "", []string{c}},
		{"before:2026-11-02", "", []string{b, a}},
		{"pizza", "", []string{b}},
		{"from:bob pizza", "", []string{b}},
		{"from:ada pizza", "", nil}, // one message must match every part
		{"carol", "", []string{c}},
		{"foo:bar", "", nil},
	}
	for _, tt := range tests {
		l, err := e.s.ListThreads(ctx, mail.ThreadFilter{Query: tt.q, Folder: tt.folder, Page: page.Params{Limit: 25}})
		if err != nil {
			t.Fatalf("%s: %v", tt.q, err)
		}
		if got := ids(l); !slices.Equal(got, tt.want) {
			t.Errorf("threads %q in %q = %v, want %v", tt.q, tt.folder, got, tt.want)
		}
	}

	msgs := []struct {
		q    string
		want int
	}{
		{"from:ada has:attachment", 1},
		{"is:starred", 1},
		{"in:starred", 1},
		{"label:work", 1},
		{"to:dave", 1},
		{"in:archive", 1},
		{"is:unread", 2},
	}
	for _, tt := range msgs {
		l, err := e.s.ListMessages(ctx, mail.MessageFilter{Query: tt.q, Page: page.Params{Limit: 25}})
		if err != nil {
			t.Fatalf("%s: %v", tt.q, err)
		}
		if len(l.Data) != tt.want {
			t.Errorf("messages %q = %d, want %d", tt.q, len(l.Data), tt.want)
		}
	}
}
