package mailbox_test

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/mailbox"
)

func setup(t *testing.T) (*mailbox.Service, *pgxpool.Pool) {
	t.Helper()
	pool := dbtest.New(t)
	ctx := context.Background()
	_, err := pool.Exec(ctx, `INSERT INTO domain (id, name, region, status, sending_enabled) VALUES
		('dom_ok', 'example.com', 'us-east-1', 'verified', true),
		('dom_pending', 'pending.com', 'us-east-1', 'pending', false)`)
	if err != nil {
		t.Fatal(err)
	}
	return &mailbox.Service{DB: pool}, pool
}

func status(err error) int {
	var e *httpx.Error
	if errors.As(err, &e) {
		return e.Status
	}
	return 0
}

func TestCreate(t *testing.T) {
	s, _ := setup(t)
	ctx := context.Background()

	first, err := s.Create(ctx, mailbox.Input{Address: "Hello@Example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if first.Address != "hello@example.com" || first.DisplayName != "hello" || !first.IsDefault || first.Color == "" {
		t.Fatalf("first = %+v", first)
	}
	sub, err := s.Create(ctx, mailbox.Input{Address: "a@billing.example.com", DisplayName: "Billing", IsDefault: true})
	if err != nil || sub.DomainID == nil || *sub.DomainID != "dom_ok" || sub.Domain != "billing.example.com" {
		t.Fatalf("subdomain mailbox = %+v %v", sub, err)
	}
	// Only one default at a time.
	first, _ = s.Get(ctx, first.ID)
	if first.IsDefault {
		t.Fatal("old default kept")
	}

	tests := []struct {
		name string
		in   mailbox.Input
		want int
	}{
		{"not an address", mailbox.Input{Address: "nope"}, 422},
		{"unknown domain", mailbox.Input{Address: "a@other.com"}, 422},
		{"duplicate", mailbox.Input{Address: "hello@example.com"}, 409},
	}
	for _, tt := range tests {
		if _, err := s.Create(ctx, tt.in); status(err) != tt.want {
			t.Errorf("%s: err = %v, want %d", tt.name, err, tt.want)
		}
	}
}

func TestUpdateClearsSignatureWithNull(t *testing.T) {
	s, _ := setup(t)
	ctx := context.Background()
	sig := "-- me"
	m, _ := s.Create(ctx, mailbox.Input{Address: "a@example.com", Signature: &sig})

	var p mailbox.Patch
	_ = json.Unmarshal([]byte(`{"display_name":"Team","signature":null}`), &p)
	m, err := s.Update(ctx, m.ID, p)
	if err != nil || m.DisplayName != "Team" || m.Signature != nil {
		t.Fatalf("got %+v %v", m, err)
	}
	// Absent fields stay as they are.
	_ = json.Unmarshal([]byte(`{}`), &p)
	if m, _ = s.Update(ctx, m.ID, mailbox.Patch{}); m.DisplayName != "Team" {
		t.Fatalf("display name changed: %q", m.DisplayName)
	}
	_ = json.Unmarshal([]byte(`{"display_name":""}`), &p)
	if _, err := s.Update(ctx, m.ID, p); status(err) != 422 {
		t.Fatalf("empty name: %v", err)
	}
}

func TestDeleteNeedsConfirm(t *testing.T) {
	s, _ := setup(t)
	ctx := context.Background()
	m, _ := s.Create(ctx, mailbox.Input{Address: "a@example.com"})
	if _, err := s.Delete(ctx, m.ID, false); status(err) != 409 {
		t.Fatalf("without confirm: %v", err)
	}
	if _, err := s.Delete(ctx, m.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(ctx, m.ID); status(err) != 404 {
		t.Fatalf("still there: %v", err)
	}
}

func TestForSending(t *testing.T) {
	s, _ := setup(t)
	ctx := context.Background()

	m, err := s.ForSending(ctx, "NoReply@example.com")
	if err != nil || m.Address != "noreply@example.com" {
		t.Fatalf("auto-create: %+v %v", m, err)
	}
	if _, err := s.ForSending(ctx, "a@pending.com"); !errors.Is(err, mailbox.ErrNotCovered) {
		t.Fatalf("unverified domain: %v", err)
	}
	if _, err := s.ForSending(ctx, "a@stranger.com"); !errors.Is(err, mailbox.ErrNotCovered) {
		t.Fatalf("unknown domain: %v", err)
	}

	// Two first sends from one new address race; both get the same row.
	var wg sync.WaitGroup
	ids := make([]string, 2)
	for i := range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if m, err := s.ForSending(ctx, "race@example.com"); err == nil {
				ids[i] = m.ID
			}
		}()
	}
	wg.Wait()
	if ids[0] == "" || ids[0] != ids[1] {
		t.Fatalf("race ids = %v", ids)
	}
}
