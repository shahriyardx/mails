package apikey_test

import (
	"context"
	"testing"

	"github.com/shahriyardx/mails/internal/apikey"
	"github.com/shahriyardx/mails/internal/db/dbtest"
)

func TestScopes(t *testing.T) {
	tests := []struct {
		granted []string
		needed  string
		want    bool
	}{
		{[]string{"*"}, "webhooks:write", true},
		{[]string{"mail:write"}, "mail:read", true},
		{[]string{"mail:read"}, "mail:write", false},
		{[]string{"emails:send"}, "emails:read", true},
		{[]string{"emails:read"}, "mail:read", false},
	}
	for _, tt := range tests {
		if got := apikey.Has(tt.granted, tt.needed); got != tt.want {
			t.Errorf("Has(%v, %s) = %v", tt.granted, tt.needed, got)
		}
	}
}

func TestKeyLifecycle(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `INSERT INTO domain (id, name, region) VALUES ('dom_a', 'a.test', 'x'), ('dom_b', 'b.test', 'x');
		INSERT INTO mailbox (id, address, domain, domain_id, display_name) VALUES
			('mbx_a1', 'one@a.test', 'a.test', 'dom_a', 'x'), ('mbx_b1', 'one@b.test', 'b.test', 'dom_b', 'x')`)
	s := &apikey.Service{DB: pool}

	if _, _, err := s.Create(ctx, apikey.Input{Name: "x", Scopes: []string{"bogus"}}); err == nil {
		t.Fatal("accepted a bogus scope")
	}
	if _, _, err := s.Create(ctx, apikey.Input{Name: "x", Scopes: []string{"*"}, Reach: apikey.Reach{DomainIDs: []string{"dom_zzz"}}}); err == nil {
		t.Fatal("accepted an unknown domain")
	}
	k, token, err := s.Create(ctx, apikey.Input{Name: "Support", Scopes: []string{"mail:read"}, Reach: apikey.Reach{DomainIDs: []string{"dom_a"}}})
	if err != nil || k.RateLimit != 300 || len(token) < 40 {
		t.Fatalf("create: %+v %q %v", k, token, err)
	}
	got, err := s.Authenticate(ctx, token)
	if err != nil || got == nil || got.ID != k.ID || got.LastUsedAt == nil {
		t.Fatalf("authenticate: %+v %v", got, err)
	}
	if got, _ := s.Authenticate(ctx, token+"x"); got != nil {
		t.Fatal("wrong token accepted")
	}
	allowed, _ := apikey.Allowed(ctx, pool, got.Reach)
	if len(allowed) != 1 || allowed[0] != "mbx_a1" {
		t.Fatalf("allowed = %v", allowed)
	}
	if ok, _ := apikey.CoversDomainOf(ctx, pool, got.Reach, "new@x.a.test"); !ok {
		t.Fatal("domain reach should cover a subdomain address")
	}
	if ok, _ := apikey.CoversDomainOf(ctx, pool, got.Reach, "new@b.test"); ok {
		t.Fatal("domain reach covers another domain")
	}
	if err := s.Revoke(ctx, k.ID); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Authenticate(ctx, token); got != nil {
		t.Fatal("revoked key accepted")
	}
	nothing, _ := apikey.Allowed(ctx, pool, apikey.Reach{MailboxIDs: []string{"mbx_gone"}})
	if nothing == nil || len(nothing) != 0 {
		t.Fatalf("restricted-to-nothing = %v, want empty non-nil", nothing)
	}
}
