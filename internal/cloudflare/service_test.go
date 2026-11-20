package cloudflare_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/shahriyardx/mails/internal/cloudflare"
	"github.com/shahriyardx/mails/internal/cloudflare/cffake"
	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/secret"
)

func setup(t *testing.T) (*cloudflare.Service, *cffake.Fake) {
	t.Helper()
	box, _ := secret.New("test-secret-0123456789")
	fake := cffake.New(cloudflare.Zone{ID: "z1", Name: "a.test", AccountID: "acct"})
	return &cloudflare.Service{DB: dbtest.New(t), Box: box, NewAPI: fake.For, AppURL: "https://mail.a.test",
		InboundSecret: "inbound-s3cret", R2Bucket: "bucket", Script: []byte("export default {}")}, fake
}

func code(err error) int {
	var e *httpx.Error
	if errors.As(err, &e) {
		return e.Status
	}
	return 0
}

func TestConnectStoresTokenSealed(t *testing.T) {
	s, fake := setup(t)
	ctx := context.Background()
	if err := s.Deploy(ctx); err == nil {
		t.Fatal("deploy before connect")
	}
	st, err := s.Connect(ctx, "  tok-abcd1234 ")
	if err != nil || !st.Connected || st.AccountID != "acct" || st.Hint != "…1234" || len(st.Zones) != 1 {
		t.Fatalf("status = %+v %v", st, err)
	}
	var sealed string
	_ = s.DB.QueryRow(ctx, `SELECT secret FROM integration`).Scan(&sealed)
	if strings.Contains(sealed, "tok-abcd1234") {
		t.Fatal("token stored in the clear")
	}
	if _, _, err := s.Client(ctx); err != nil || fake.Tokens[len(fake.Tokens)-1] != "tok-abcd1234" {
		t.Fatalf("client: %v %v", err, fake.Tokens)
	}
	// A different SECRET cannot read it: treated as not connected.
	other, _ := secret.New("another-secret-0123456789")
	s2 := *s
	s2.Box = other
	if _, _, err := s2.Client(ctx); err == nil {
		t.Fatal("read token with the wrong secret")
	}
	fake.BadToken = true
	if _, err := s.Connect(ctx, "bad"); code(err) != 422 || !strings.Contains(err.Error(), "token") {
		t.Fatalf("bad token: %v", err)
	}
}

func TestDeployAndRoute(t *testing.T) {
	s, fake := setup(t)
	ctx := context.Background()
	if _, err := s.Connect(ctx, "tok"); err != nil {
		t.Fatal(err)
	}
	local := *s
	local.AppURL = "http://localhost:3000"
	if err := local.Deploy(ctx); code(err) != 422 {
		t.Fatalf("localhost deploy: %v", err)
	}
	if err := s.Deploy(ctx); err != nil {
		t.Fatal(err)
	}
	b := map[string]cloudflare.Binding{}
	for _, x := range fake.Uploaded {
		b[x.Name] = x
	}
	if b["INBOUND_WEBHOOK_SECRET"].Type != "secret_text" || b["INBOUND_WEBHOOK_SECRET"].Text != "inbound-s3cret" ||
		b["APP_INBOUND_URL"].Text != "https://mail.a.test/api/inbound" || b["TRUST_AUTH_RESULTS"].Text != "false" || b["ATTACHMENTS"].Bucket != "bucket" {
		t.Fatalf("bindings = %+v", b)
	}
	if err := s.RouteZone(ctx, "z1"); err != nil {
		t.Fatal(err)
	}
	st, _ := s.Status(ctx)
	if !st.Deployed || !st.Zones[0].RoutingEnabled || !st.Zones[0].CatchAllToWorker {
		t.Fatalf("status = %+v", st)
	}

	// Subdomains: published once, then left alone.
	if r := s.EnsureSubdomainReceiving(ctx, "billing.a.test"); r.State != "published" || len(fake.MX["billing.a.test"]) != 3 {
		t.Fatalf("receiving = %+v", r)
	}
	if r := s.EnsureSubdomainReceiving(ctx, "billing.a.test"); r.State != "already" {
		t.Fatalf("second = %+v", r)
	}
	if r := s.EnsureSubdomainReceiving(ctx, "x.other.test"); r.State != "skipped" {
		t.Fatalf("foreign = %+v", r)
	}
	if err := s.UnrouteZone(ctx, "z1", true); err != nil {
		t.Fatal(err)
	}
	if r := s.EnsureSubdomainReceiving(ctx, "new.a.test"); r.State != "skipped" {
		t.Fatalf("unrouted zone = %+v", r)
	}
}
