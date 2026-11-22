package push

import "testing"

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
