package secret

import "testing"

func TestSealOpen(t *testing.T) {
	a, _ := New("0123456789abcdef-one")
	b, _ := New("0123456789abcdef-two")
	sealed := a.Seal("cf-token")
	if sealed == a.Seal("cf-token") {
		t.Fatal("same plaintext sealed twice to the same value")
	}
	if got, err := a.Open(sealed); err != nil || got != "cf-token" {
		t.Fatalf("open = %q %v", got, err)
	}
	if _, err := b.Open(sealed); err == nil {
		t.Fatal("opened with another key")
	}
	if _, err := a.Open("garbage"); err == nil {
		t.Fatal("opened garbage")
	}
	if _, err := New("short"); err == nil {
		t.Fatal("accepted a short secret")
	}
}
