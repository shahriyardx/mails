package domain_test

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/shahriyardx/mails/internal/apikey"
	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/domain"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/ses/sesfake"
)

type fakeDNS map[string][]string

func (f fakeDNS) LookupTXT(_ context.Context, name string) ([]string, error) {
	if v, ok := f[name]; ok {
		return v, nil
	}
	return nil, errors.New("nxdomain")
}

func newService(t *testing.T) (*domain.Service, *sesfake.Fake, fakeDNS) {
	t.Helper()
	fake, dns := sesfake.New(), fakeDNS{}
	return &domain.Service{
		DB: dbtest.New(t), SES: fake, DNS: dns, Region: "us-east-1",
		Selector: "Mail!", MailFromPrefix: "mail", Now: time.Now,
	}, fake, dns
}

func status(err error) int {
	var e *httpx.Error
	if errors.As(err, &e) {
		return e.Status
	}
	return 0
}

func TestAddNewDomainUsesOwnDKIMKey(t *testing.T) {
	s, fake, _ := newService(t)
	ctx := context.Background()

	d, err := s.Add(ctx, "https://Example.com/")
	if err != nil {
		t.Fatal(err)
	}
	if d.Name != "example.com" || d.Status != "pending" || d.Sendable() {
		t.Fatalf("got %+v", d)
	}
	if fake.Identities["example.com"].DKIMOrigin != "EXTERNAL" {
		t.Fatal("identity not switched to our key")
	}
	if d.DKIMPublicKey == nil || d.MailFromDomain == nil || *d.MailFromDomain != "mail.example.com" {
		t.Fatalf("key or mail from missing: %+v", d)
	}
	// DKIM is one TXT record with our public key, under the cleaned selector.
	r := d.Records[0]
	if r.Kind != "TXT" || r.Name != "mail._domainkey.example.com" || r.Value != "p="+*d.DKIMPublicKey {
		t.Fatalf("dkim record = %+v", r)
	}
	if len(d.Records) != 5 {
		t.Fatalf("records = %d, want 5 (dkim, mx, return-path spf, spf, dmarc)", len(d.Records))
	}
}

func TestAddRejects(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	if _, err := s.Add(ctx, "not a domain"); status(err) != 422 {
		t.Fatalf("bad name: %v", err)
	}
	if _, err := s.Add(ctx, "example.com"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Add(ctx, "EXAMPLE.com"); status(err) != 409 {
		t.Fatalf("duplicate: %v", err)
	}
}

func TestMailFromFailureIsNotFatal(t *testing.T) {
	s, fake, _ := newService(t)
	fake.MailFromErr = errors.New("denied")
	d, err := s.Add(context.Background(), "example.com")
	if err != nil {
		t.Fatal(err)
	}
	if d.MailFromDomain != nil || len(d.Records) != 3 {
		t.Fatalf("mail from = %v, records = %d", d.MailFromDomain, len(d.Records))
	}
}

func TestSubdomainOfVerifiedIsInherited(t *testing.T) {
	s, fake, dns := newService(t)
	ctx := context.Background()
	parent, _ := s.Add(ctx, "example.com")

	// Not verified yet: the subdomain needs its own identity.
	early, err := s.Add(ctx, "early.example.com")
	if err != nil || early.InheritedFrom != nil {
		t.Fatalf("early: %+v %v", early, err)
	}

	fake.Verify("example.com")
	dns["example.com"] = []string{"v=spf1 include:amazonses.com ~all"}
	dns["_dmarc.example.com"] = []string{"v=DMARC1; p=none"}
	parent, err = s.Refresh(ctx, parent.ID)
	if err != nil || !parent.Sendable() || !parent.SPFVerified || !parent.DMARCVerified {
		t.Fatalf("refresh: %+v %v", parent, err)
	}

	sub, err := s.Add(ctx, "billing.example.com")
	if err != nil {
		t.Fatal(err)
	}
	if sub.InheritedFrom == nil || *sub.InheritedFrom != "example.com" || !sub.Sendable() || len(sub.Records) != 0 {
		t.Fatalf("sub = %+v", sub)
	}
	if _, ok := fake.Identities["billing.example.com"]; ok {
		t.Fatal("inherited subdomain must not create an identity")
	}

	// Removing it with delete_in_ses must not touch any identity.
	if _, deleted, err := s.Remove(ctx, "billing.example.com", true); err != nil || deleted {
		t.Fatalf("remove: deleted=%v err=%v", deleted, err)
	}
	if len(fake.Deleted) != 0 {
		t.Fatalf("deleted identities = %v", fake.Deleted)
	}
}

// A mailbox is filed under the closest domain covering it, which is what
// an API key scoped to a domain reaches. Adding or removing a domain
// re-files the mailboxes it changes.
func TestMailboxesFollowClosestDomain(t *testing.T) {
	s, _, _ := newService(t)
	ctx := context.Background()
	parent, err := s.Add(ctx, "a.test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(ctx, `INSERT INTO mailbox (id, address, domain, domain_id, display_name) VALUES
		('mbx_top', 'x@a.test', 'a.test', $1, 'X'), ('mbx_sub', 'x@sub.a.test', 'sub.a.test', $1, 'X')`, parent.ID); err != nil {
		t.Fatal(err)
	}
	reach := func(domainID string) []string {
		t.Helper()
		ids, err := apikey.Allowed(ctx, s.DB, apikey.Reach{DomainIDs: []string{domainID}})
		if err != nil {
			t.Fatal(err)
		}
		slices.Sort(ids)
		return ids
	}
	check := func(step, domainID string, want ...string) {
		t.Helper()
		if got := reach(domainID); !slices.Equal(got, want) {
			t.Errorf("%s: key on %s reaches %v, want %v", step, domainID, got, want)
		}
	}

	sub, err := s.Add(ctx, "sub.a.test")
	if err != nil {
		t.Fatal(err)
	}
	check("subdomain added", parent.ID, "mbx_top")
	check("subdomain added", sub.ID, "mbx_sub")

	if _, _, err := s.Remove(ctx, "sub.a.test", false); err != nil {
		t.Fatal(err)
	}
	check("subdomain removed", parent.ID, "mbx_sub", "mbx_top")

	// Removing the parent leaves both unfiled; adding it back files both.
	if _, _, err := s.Remove(ctx, "a.test", false); err != nil {
		t.Fatal(err)
	}
	sub, err = s.Add(ctx, "sub.a.test")
	if err != nil {
		t.Fatal(err)
	}
	check("only subdomain", sub.ID, "mbx_sub")
	parent, err = s.Add(ctx, "a.test")
	if err != nil {
		t.Fatal(err)
	}
	check("parent re-added", parent.ID, "mbx_top")
	check("parent re-added", sub.ID, "mbx_sub")
	if _, _, err := s.Remove(ctx, "sub.a.test", false); err != nil {
		t.Fatal(err)
	}
	check("subdomain removed again", parent.ID, "mbx_sub", "mbx_top")
}

func TestRefreshMissingIdentityFails(t *testing.T) {
	s, fake, _ := newService(t)
	ctx := context.Background()
	d, _ := s.Add(ctx, "example.com")
	delete(fake.Identities, "example.com")
	d, err := s.Refresh(ctx, d.ID)
	if err != nil || d.Status != "failed" || d.SendingEnabled {
		t.Fatalf("got %+v %v", d, err)
	}
}

func TestImportUpserts(t *testing.T) {
	s, fake, _ := newService(t)
	ctx := context.Background()
	_ = fake.CreateIdentity(ctx, "a.com")
	_ = fake.CreateIdentity(ctx, "b.com")
	fake.Verify("a.com")
	if _, err := s.Add(ctx, "b.com"); err != nil {
		t.Fatal(err)
	}
	res, err := s.Import(ctx)
	if err != nil || res.Imported != 1 || res.Updated != 1 || res.Total != 2 {
		t.Fatalf("import = %+v %v", res, err)
	}
	a, err := s.Get(ctx, "a.com")
	if err != nil || !a.Sendable() || !a.Imported {
		t.Fatalf("a = %+v %v", a, err)
	}
	// Running again changes nothing but counts.
	if res, err = s.Import(ctx); err != nil || res.Imported != 0 || res.Updated != 2 {
		t.Fatalf("second import = %+v %v", res, err)
	}
}

func TestRemoveDeletesIdentityWhenAsked(t *testing.T) {
	s, fake, _ := newService(t)
	ctx := context.Background()
	if _, err := s.Add(ctx, "example.com"); err != nil {
		t.Fatal(err)
	}
	if _, deleted, err := s.Remove(ctx, "example.com", true); err != nil || !deleted {
		t.Fatalf("deleted=%v err=%v", deleted, err)
	}
	if _, ok := fake.Identities["example.com"]; ok {
		t.Fatal("identity still in SES")
	}
	if _, err := s.Get(ctx, "example.com"); status(err) != 404 {
		t.Fatalf("get after remove: %v", err)
	}
}

func TestRecordsForEasyDKIM(t *testing.T) {
	origin := "AWS_SES"
	d := &domain.Domain{Name: "x.com", Region: "eu-west-1", DKIMOrigin: &origin, DKIMTokens: []string{"b", "a"}}
	rs := domain.Records(d)
	if rs[0].Kind != "CNAME" || rs[0].Name != "a._domainkey.x.com" || rs[0].Value != "a.dkim.amazonses.com" {
		t.Fatalf("records = %+v", rs)
	}
	if len(rs) != 4 || rs[3].Required {
		t.Fatalf("want 2 cname + spf + optional dmarc, got %+v", rs)
	}
}

// Removing a domain but keeping its SES identity must stick: the list's
// automatic sync does not bring it back. An explicit import does.
func TestRemovedDomainStaysRemoved(t *testing.T) {
	s, fake, _ := newService(t)
	ctx := context.Background()
	_ = fake.CreateIdentity(ctx, "a.com")
	if _, err := s.Add(ctx, "a.com"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Remove(ctx, "a.com", false); err != nil {
		t.Fatal(err)
	}
	list, warning, err := s.ListFresh(ctx)
	if err != nil || warning != "" || len(list) != 0 {
		t.Fatalf("list after remove = %d rows, %q, %v", len(list), warning, err)
	}
	if res, err := s.Import(ctx); err != nil || res.Imported != 1 {
		t.Fatalf("explicit import = %+v %v", res, err)
	}
	// Brought back by hand, it is an ordinary domain again.
	if _, err := s.DB.Exec(ctx, `UPDATE domain SET last_checked_at = NULL`); err != nil {
		t.Fatal(err)
	}
	if list, _, err = s.ListFresh(ctx); err != nil || len(list) != 1 {
		t.Fatalf("list after import = %d rows, %v", len(list), err)
	}
	// Re-adding it by hand clears the mark too.
	if _, _, err := s.Remove(ctx, "a.com", false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Add(ctx, "a.com"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Remove(ctx, "a.com", true); err != nil {
		t.Fatal(err)
	}
	_ = fake.CreateIdentity(ctx, "a.com") // set up again in the SES console
	if list, _, err = s.ListFresh(ctx); err != nil || len(list) != 1 {
		t.Fatalf("identity deleted then recreated in SES: %d rows, %v", len(list), err)
	}
}

func TestSelector(t *testing.T) {
	for in, want := range map[string]string{"Mail!": "mail", "--": "mail", "s1-x": "s1-x"} {
		if got := domain.Selector(in); got != want {
			t.Errorf("Selector(%q) = %q, want %q", in, got, want)
		}
	}
}
