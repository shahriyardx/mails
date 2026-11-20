package addr

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestParseList(t *testing.T) {
	tests := []struct {
		in   string
		want []Address
	}{
		{"", nil},
		{"Ada <ADA@X.com>, bob@y.com", []Address{{"Ada", "ada@x.com"}, {"", "bob@y.com"}}},
		{`"Doe, Jane" <jane@x.com>`, []Address{{"Doe, Jane", "jane@x.com"}}},
		// Not RFC 5322 (unquoted dot in name), still readable.
		{"J. R. <jr@x.com>; not-an-address", []Address{{"J. R.", "jr@x.com"}}},
	}
	for _, tt := range tests {
		if got := ParseList(tt.in); !reflect.DeepEqual(got, tt.want) {
			t.Errorf("ParseList(%q) = %#v, want %#v", tt.in, got, tt.want)
		}
	}
}

func TestAddressJSONNullName(t *testing.T) {
	b, _ := json.Marshal(Address{Address: "a@b.co"})
	if string(b) != `{"name":null,"address":"a@b.co"}` {
		t.Fatalf("got %s", b)
	}
	var a Address
	if err := json.Unmarshal([]byte(`{"name":null,"address":"a@b.co"}`), &a); err != nil || a.Address != "a@b.co" {
		t.Fatalf("round trip: %v %#v", err, a)
	}
}

func TestNormalizeDomain(t *testing.T) {
	tests := []struct {
		in   string
		want string
		ok   bool
	}{
		{"Example.com", "example.com", true},
		{"https://mail.example.com/path", "mail.example.com", true},
		{"example", "example", false},
		{"-bad.com", "-bad.com", false},
		{"a..b.com", "a..b.com", false},
	}
	for _, tt := range tests {
		got, ok := NormalizeDomain(tt.in)
		if got != tt.want || ok != tt.ok {
			t.Errorf("NormalizeDomain(%q) = %q,%v want %q,%v", tt.in, got, ok, tt.want, tt.ok)
		}
	}
}

func TestCovering(t *testing.T) {
	names := []string{"example.com", "billing.example.com", "other.com"}
	tests := []struct {
		address string
		want    int
	}{
		{"a@example.com", 0},
		{"a@x.billing.example.com", 1}, // closest parent wins
		{"a@notexample.com", -1},       // suffix without a dot is not a subdomain
		{"a@other.com", 2},
	}
	for _, tt := range tests {
		if got := Covering(tt.address, names); got != tt.want {
			t.Errorf("Covering(%q) = %d, want %d", tt.address, got, tt.want)
		}
	}
}

func TestSubjects(t *testing.T) {
	if got := NormalizeSubject("Re: RE: Fwd: [2] hello"); got != "[2] hello" {
		t.Errorf("NormalizeSubject = %q", got)
	}
	if got := ReplySubject("Re: hi"); got != "Re: hi" {
		t.Errorf("ReplySubject = %q", got)
	}
	if got := ForwardSubject(""); got != "Fwd:" {
		t.Errorf("ForwardSubject = %q", got)
	}
}

func TestSnippet(t *testing.T) {
	if got := Snippet("", "<style>x{}</style><p>Hello&nbsp;<b>there</b></p><p>friend</p>"); got != "Hello there friend" {
		t.Errorf("Snippet = %q", got)
	}
	if got := Snippet("  plain\n\ntext ", "<p>ignored</p>"); got != "plain text" {
		t.Errorf("Snippet = %q", got)
	}
}
