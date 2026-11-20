package mail

import (
	"slices"
	"testing"

	"github.com/shahriyardx/mails/internal/addr"
)

// Contacts are upserted in one order whatever order the recipients came
// in, so two sends to [a, b] and [b, a] cannot deadlock on the rows.
func TestContactOrder(t *testing.T) {
	tests := []struct {
		name string
		in   []addr.Address
		want []addr.Address
	}{
		{"empty", nil, []addr.Address{}},
		{"sorted by address", []addr.Address{{Address: "b@x.test"}, {Address: "a@x.test"}},
			[]addr.Address{{Address: "a@x.test"}, {Address: "b@x.test"}}},
		{"case folded and deduped, name kept", []addr.Address{{Address: "B@x.test"}, {Name: "Bee", Address: "b@x.test"}, {Address: "a@x.test"}},
			[]addr.Address{{Address: "a@x.test"}, {Name: "Bee", Address: "b@x.test"}}},
		{"blank dropped", []addr.Address{{Address: ""}, {Address: "a@x.test"}}, []addr.Address{{Address: "a@x.test"}}},
	}
	for _, tt := range tests {
		if got := contactOrder(tt.in); !slices.Equal(got, tt.want) {
			t.Errorf("%s: got %v, want %v", tt.name, got, tt.want)
		}
	}
}
