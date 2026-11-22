package push

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"testing"
)

// webpush-go adds "mailto:" itself; a doubled prefix makes Apple reject every send.
func TestVAPIDSubscriber(t *testing.T) {
	for in, want := range map[string]string{
		"mailto:me@example.com":   "me@example.com",
		" mailto:me@example.com ": "me@example.com",
		"me@example.com":          "me@example.com",
		"https://example.com":     "https://example.com",
	} {
		if got := vapidSubscriber(in); got != want {
			t.Errorf("vapidSubscriber(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestWithoutURLHidesEndpoint(t *testing.T) {
	err := fmt.Errorf("send: %w", &url.Error{Op: "Post", URL: "https://fcm.googleapis.com/fcm/send/SECRET", Err: errors.New("timeout")})
	if got := withoutURL(err); got == nil || strings.Contains(got.Error(), "SECRET") || got.Error() != "timeout" {
		t.Fatalf("withoutURL = %v", got)
	}
	if withoutURL(nil) != nil {
		t.Fatal("nil error changed")
	}
}
