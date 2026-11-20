package safehttp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"
)

func TestAllowed(t *testing.T) {
	for ip, want := range map[string]bool{
		"8.8.8.8": true, "2606:4700::1111": true,
		"127.0.0.1": false, "10.1.2.3": false, "192.168.1.1": false, "172.16.0.1": false,
		"169.254.169.254": false, "100.64.0.1": false, "::1": false, "fe80::1": false,
		"0.0.0.0": false, "::ffff:127.0.0.1": false, "fd00::1": false,
	} {
		if got := Allowed(netip.MustParseAddr(ip)); got != want {
			t.Errorf("Allowed(%s) = %v", ip, got)
		}
	}
}

func TestClientRefusesLoopback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()
	if _, err := Client(time.Second, false).Get(srv.URL); !errors.Is(err, ErrBlocked) {
		t.Fatalf("loopback: err = %v", err)
	}
	res, err := Client(time.Second, true).Get(srv.URL)
	if err != nil {
		t.Fatalf("loopback allowed: %v", err)
	}
	res.Body.Close()
}

func TestCheckURL(t *testing.T) {
	ctx := context.Background()
	for raw, ok := range map[string]bool{
		"http://example.com/x":         false,
		"https://127.0.0.1/x":          false,
		"https://user:pw@example.com/": false,
		"https://localhost:8080/":      false,
		"ftp://example.com":            false,
	} {
		if err := CheckURL(ctx, raw, false); (err == nil) != ok {
			t.Errorf("CheckURL(%q) = %v", raw, err)
		}
	}
	if err := CheckURL(ctx, "http://localhost:8080/hook", true); err != nil {
		t.Errorf("local dev url: %v", err)
	}
}
