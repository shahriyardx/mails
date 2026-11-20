package avatar

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shahriyardx/mails/internal/db/dbtest"
)

// fakeWeb answers by URL prefix and counts calls.
type fakeWeb struct {
	mu    sync.Mutex
	pages map[string]*http.Response
	calls []string
}

func img(ct, body string) *http.Response {
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {ct}}, Body: io.NopCloser(strings.NewReader(body))}
}

func (f *fakeWeb) Do(r *http.Request) (*http.Response, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	u := r.URL.String()
	f.calls = append(f.calls, u)
	for prefix, res := range f.pages {
		if strings.HasPrefix(u, prefix) {
			return res, nil
		}
	}
	return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader(""))}, nil
}

type fakeDNS map[string][]string

func (f fakeDNS) LookupTXT(_ context.Context, name string) ([]string, error) {
	if r, ok := f[name]; ok {
		return r, nil
	}
	return nil, errors.New("no such host")
}

func TestGet(t *testing.T) {
	cases := []struct {
		name    string
		address string
		pages   map[string]*http.Response
		dns     fakeDNS
		wantCT  string // "" = no picture
	}{
		{"gravatar wins", "ada@example.com",
			map[string]*http.Response{"https://www.gravatar.com/": img("image/png", "G")}, nil, "image/png"},
		{"bimi logo on parent domain", "news@mail.brand.com",
			map[string]*http.Response{"https://cdn.brand.com/logo.svg": img("image/svg+xml", "<svg/>")},
			fakeDNS{"default._bimi.brand.com": {"v=BIMI1; l=https://cdn.brand.com/logo.svg; a="}}, "image/svg+xml"},
		{"site icon", "hi@shop.example",
			map[string]*http.Response{"https://shop.example/favicon.ico": img("image/x-icon", "I")}, nil, "image/x-icon"},
		{"svg refused outside bimi", "hi@svg.example",
			map[string]*http.Response{"https://svg.example/favicon.ico": img("image/svg+xml", "<svg/>")}, nil, ""},
		{"html refused", "hi@html.example",
			map[string]*http.Response{"https://html.example/": img("text/html", "<script>")}, nil, ""},
		{"too big refused", "hi@big.example",
			map[string]*http.Response{"https://big.example/favicon.ico": img("image/png", strings.Repeat("x", maxBytes+1))}, nil, ""},
		{"freemail skips domain lookups", "someone@gmail.com",
			map[string]*http.Response{"https://gmail.com/": img("image/png", "logo")}, nil, ""},
		{"bad address", "not an address", nil, nil, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			web := &fakeWeb{pages: tc.pages}
			s := &Service{DB: dbtest.New(t), HTTP: web, DNS: tc.dns, Now: time.Now}
			got, err := s.Get(context.Background(), tc.address)
			if err != nil {
				t.Fatal(err)
			}
			if (got == nil) != (tc.wantCT == "") || (got != nil && got.ContentType != tc.wantCT) {
				t.Fatalf("got %+v, want content type %q", got, tc.wantCT)
			}
			if tc.name == "freemail skips domain lookups" {
				for _, c := range web.calls {
					if !strings.HasPrefix(c, "https://www.gravatar.com/") {
						t.Fatalf("looked up %s for a freemail sender", c)
					}
				}
			}
		})
	}
}

func TestCachesHitsAndMisses(t *testing.T) {
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	web := &fakeWeb{pages: map[string]*http.Response{}}
	s := &Service{DB: dbtest.New(t), HTTP: web, DNS: fakeDNS{}, Now: func() time.Time { return now }}
	ctx := context.Background()

	if img, _ := s.Get(ctx, "x@nothing.example"); img != nil {
		t.Fatal("want miss")
	}
	first := len(web.calls)
	if first == 0 {
		t.Fatal("want outside lookups on first call")
	}
	if img, _ := s.Get(ctx, "x@nothing.example"); img != nil || len(web.calls) != first {
		t.Fatalf("miss not cached: %d calls after %d", len(web.calls), first)
	}
	// After the miss TTL, it looks again and finds the new picture.
	now = now.Add(missTTL + time.Minute)
	web.pages["https://www.gravatar.com/"] = img("image/jpeg", "J")
	if img, _ := s.Get(ctx, "x@nothing.example"); img == nil || string(img.Data) != "J" {
		t.Fatalf("want fresh hit, got %+v", img)
	}
	n := len(web.calls)
	if img, _ := s.Get(ctx, "x@nothing.example"); img == nil || len(web.calls) != n {
		t.Fatal("hit not cached")
	}
}

func TestHandler(t *testing.T) {
	web := &fakeWeb{pages: map[string]*http.Response{"https://cdn.brand.com/": img("image/svg+xml", "<svg/>")}}
	s := &Service{DB: dbtest.New(t), HTTP: web, DNS: fakeDNS{"default._bimi.brand.com": {"v=BIMI1; l=https://cdn.brand.com/l.svg"}}, Now: time.Now}
	h := Handler(s)

	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/?address=a@brand.com", nil))
	if w.Code != 200 || w.Header().Get("Content-Type") != "image/svg+xml" ||
		!strings.Contains(w.Header().Get("Content-Security-Policy"), "sandbox") || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("hit: %d %v", w.Code, w.Header())
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/?address=a@none.example", nil))
	if w.Code != 404 || w.Header().Get("Cache-Control") == "" {
		t.Fatalf("miss: %d %v", w.Code, w.Header())
	}
}
