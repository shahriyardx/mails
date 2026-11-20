package forwarding_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/shahriyardx/mails/internal/cloudflare"
	"github.com/shahriyardx/mails/internal/cloudflare/cffake"
	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/forwarding"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/secret"
)

func code(err error) int {
	var e *httpx.Error
	if errors.As(err, &e) {
		return e.Status
	}
	return 0
}

func TestManager(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `INSERT INTO domain (id, name, region) VALUES ('dom_a', 'a.test', 'us-east-1')`)
	box, _ := secret.New("test-secret-0123456789")
	fake := cffake.New(cloudflare.Zone{ID: "z1", Name: "a.test", AccountID: "acct"})
	cf := &cloudflare.Service{DB: pool, Box: box, NewAPI: fake.For}
	m := &forwarding.Manager{DB: pool, CF: cf}

	if _, err := m.AddAddress(ctx, "me@gmail.test"); code(err) != 422 {
		t.Fatalf("before connect: %v", err)
	}
	if _, err := cf.Connect(ctx, "tok"); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AddAddress(ctx, "loop@sub.a.test"); code(err) != 422 {
		t.Fatalf("own domain: %v", err)
	}
	verified := time.Now()
	fake.Dests = []cloudflare.Destination{{ID: "dst_old", Email: "me@gmail.test", Verified: &verified}, {ID: "dst_x", Email: "x@a.test"}}
	a, err := m.AddAddress(ctx, "Me@Gmail.test")
	if err != nil || !a.Verified || len(fake.Dests) != 2 {
		t.Fatalf("reuse destination: %+v %v (dests %d)", a, err, len(fake.Dests))
	}
	if _, err := m.AddAddress(ctx, "me@gmail.test"); code(err) != 409 {
		t.Fatalf("duplicate: %v", err)
	}
	if _, err := m.AddRule(ctx, a.ID, "dom_a", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := m.AddRule(ctx, a.ID, "dom_a", ""); code(err) != 409 {
		t.Fatalf("duplicate rule: %v", err)
	}
	if _, err := m.AddRule(ctx, a.ID, "", ""); err != nil {
		t.Fatal(err)
	}
	fake.Dests = append(fake.Dests, cloudflare.Destination{ID: "dst_new", Email: "new@else.test"})
	if err := m.Refresh(ctx); err != nil {
		t.Fatal(err)
	}
	v, err := m.View(ctx)
	if err != nil || !v.Connected || len(v.Addresses) != 2 || len(v.Instance) != 1 || len(v.Domains[0].Rules) != 1 {
		t.Fatalf("view = %+v %v", v, err)
	}
	for _, x := range v.Addresses {
		if x.Address == "x@a.test" {
			t.Fatal("adopted a destination on our own domain")
		}
	}
	if err := m.RemoveAddress(ctx, a.ID, true); err != nil {
		t.Fatal(err)
	}
	if v, _ = m.View(ctx); len(v.Instance) != 0 {
		t.Fatal("rules outlived their address")
	}
}
