package server

import (
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestSPACaching(t *testing.T) {
	web := fstest.MapFS{
		"index.html":           {Data: []byte("<html>")},
		"sw.js":                {Data: []byte("//sw")},
		"manifest.webmanifest": {Data: []byte("{}")},
		"assets/app-1.js":      {Data: []byte("//js")},
		"favicon.svg":          {Data: []byte("<svg/>")},
	}
	tests := []struct {
		path, cache, ctype string
	}{
		{"/mail/all/inbox", "no-cache", "text/html; charset=utf-8"},
		{"/sw.js", "no-cache", "text/javascript; charset=utf-8"},
		{"/manifest.webmanifest", "no-cache", "application/manifest+json"},
		{"/assets/app-1.js", "public, max-age=31536000, immutable", "text/javascript; charset=utf-8"},
		{"/favicon.svg", "", "image/svg+xml"},
	}
	for _, tt := range tests {
		rec := httptest.NewRecorder()
		spa(web).ServeHTTP(rec, httptest.NewRequest("GET", tt.path, nil))
		if got := rec.Header().Get("Cache-Control"); got != tt.cache {
			t.Errorf("%s: Cache-Control = %q, want %q", tt.path, got, tt.cache)
		}
		if got := rec.Header().Get("Content-Type"); got != tt.ctype {
			t.Errorf("%s: Content-Type = %q, want %q", tt.path, got, tt.ctype)
		}
	}
}
