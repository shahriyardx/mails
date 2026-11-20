package page

import (
	"net/url"
	"testing"
)

func TestParse(t *testing.T) {
	tests := []struct {
		q       string
		limit   int
		cursor  *Cursor
		wantErr bool
	}{
		{"", DefaultLimit, nil, false},
		{"limit=500", MaxLimit, nil, false},
		{"limit=0", 0, nil, true},
		{"cursor=17%7Cthr_1", DefaultLimit, &Cursor{17, "thr_1"}, false},
		{"cursor=nope", 0, nil, true},
	}
	for _, tt := range tests {
		q, _ := url.ParseQuery(tt.q)
		p, err := Parse(q)
		if (err != nil) != tt.wantErr {
			t.Errorf("%q: err = %v", tt.q, err)
			continue
		}
		if tt.wantErr {
			continue
		}
		if p.Limit != tt.limit || (tt.cursor == nil) != (p.Cursor == nil) || (tt.cursor != nil && *tt.cursor != *p.Cursor) {
			t.Errorf("%q: got %+v", tt.q, p)
		}
	}
}

func TestBuild(t *testing.T) {
	key := func(n int) (int64, string) { return int64(n), "id" }
	l := Build([]int{3, 2, 1}, 2, key)
	if !l.HasMore || len(l.Data) != 2 || *l.NextCursor != "2|id" {
		t.Fatalf("got %+v", l)
	}
	l = Build([]int(nil), 2, key)
	if l.HasMore || l.Data == nil || l.NextCursor != nil {
		t.Fatalf("empty: %+v", l)
	}
}
