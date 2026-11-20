// Package cloudflare connects the owner's Cloudflare account: the API token
// (stored encrypted), the inbound Email Worker, Email Routing on each zone,
// MX records for subdomains, and the forward destinations Email Routing
// can deliver to.
package cloudflare

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	cf "github.com/cloudflare/cloudflare-go/v6"
	"github.com/cloudflare/cloudflare-go/v6/dns"
	"github.com/cloudflare/cloudflare-go/v6/email_routing"
	"github.com/cloudflare/cloudflare-go/v6/option"
	"github.com/cloudflare/cloudflare-go/v6/workers"
	"github.com/cloudflare/cloudflare-go/v6/zones"
)

// Zone is a Cloudflare zone the token can see.
type Zone struct {
	ID        string
	Name      string
	AccountID string
}

// Binding is one worker binding.
type Binding struct {
	Type   string // r2_bucket, plain_text, secret_text
	Name   string
	Text   string
	Bucket string
}

// Destination is an Email Routing destination address.
type Destination struct {
	ID       string
	Email    string
	Verified *time.Time
}

// MX is one Email Routing MX host.
type MX struct {
	Host     string
	Priority int
}

// EmailRoutingMX are the hosts a domain needs to receive through Email Routing.
var EmailRoutingMX = []MX{{"route1.mx.cloudflare.net", 91}, {"route2.mx.cloudflare.net", 99}, {"route3.mx.cloudflare.net", 1}}

// API is what Mails asks of Cloudflare, bound to one token.
type API interface {
	VerifyToken(ctx context.Context) error
	Zones(ctx context.Context) ([]Zone, error)
	WorkerModified(ctx context.Context, account, script string) (*time.Time, error) // nil: not deployed
	UploadWorker(ctx context.Context, account, script string, code []byte, compatDate string, flags []string, bindings []Binding) error
	DeleteWorker(ctx context.Context, account, script string) error
	RoutingEnabled(ctx context.Context, zone string) (bool, error)
	SetRouting(ctx context.Context, zone, zoneName string, on bool) error
	// CatchAllWorker returns the worker the catch-all rule sends to, "" if none.
	CatchAllWorker(ctx context.Context, zone string) (string, error)
	// SetCatchAll points the catch-all at script, or drops mail when "".
	SetCatchAll(ctx context.Context, zone, script string) error
	MXCount(ctx context.Context, zone, name string) (int, error)
	AddMX(ctx context.Context, zone, name string, mx MX, comment string) error
	Destinations(ctx context.Context, account string) ([]Destination, error)
	AddDestination(ctx context.Context, account, email string) (*Destination, error)
	DeleteDestination(ctx context.Context, account, id string) error
}

// Error is a Cloudflare refusal with its codes. Code 10000 is
// "Authentication error": a bad token or a missing permission.
type Error struct {
	Codes   []int
	Message string
}

func (e *Error) Error() string { return e.Message }

// Unauthorized reports whether err is Cloudflare's code 10000.
func Unauthorized(err error) bool {
	var e *Error
	if errors.As(err, &e) {
		for _, c := range e.Codes {
			if c == 10000 {
				return true
			}
		}
	}
	return false
}

// NewAPI builds the real client for token.
func NewAPI(token string) API {
	return &api{c: cf.NewClient(option.WithAPIToken(token), option.WithRequestTimeout(30*time.Second))}
}

type api struct{ c *cf.Client }

// wrap turns an SDK error into *Error so callers can read the codes.
func wrap(err error) error {
	if err == nil {
		return nil
	}
	var apiErr *cf.Error
	if errors.As(err, &apiErr) {
		e := &Error{Message: fmt.Sprintf("Cloudflare said %d", apiErr.StatusCode)}
		var msgs []string
		for _, x := range apiErr.Errors {
			e.Codes = append(e.Codes, int(x.Code))
			msgs = append(msgs, x.Message)
		}
		if len(msgs) > 0 {
			e.Message = "Cloudflare said: " + strings.Join(msgs, "; ")
		}
		return e
	}
	return err
}

func (a *api) VerifyToken(ctx context.Context) error {
	_, err := a.c.User.Tokens.Verify(ctx)
	return wrap(err)
}

func (a *api) Zones(ctx context.Context) ([]Zone, error) {
	var out []Zone
	iter := a.c.Zones.ListAutoPaging(ctx, zones.ZoneListParams{})
	for iter.Next() {
		z := iter.Current()
		out = append(out, Zone{ID: z.ID, Name: z.Name, AccountID: z.Account.ID})
	}
	return out, wrap(iter.Err())
}

func (a *api) WorkerModified(ctx context.Context, account, script string) (*time.Time, error) {
	iter := a.c.Workers.Scripts.ListAutoPaging(ctx, workers.ScriptListParams{AccountID: cf.F(account)})
	for iter.Next() {
		if s := iter.Current(); s.ID == script {
			t := s.ModifiedOn
			return &t, nil
		}
	}
	return nil, wrap(iter.Err())
}

type namedFile struct {
	io.Reader
	name, contentType string
}

func (f *namedFile) Filename() string    { return f.name }
func (f *namedFile) ContentType() string { return f.contentType }

func (a *api) UploadWorker(ctx context.Context, account, script string, code []byte, compatDate string, flags []string, bindings []Binding) error {
	var bs []workers.ScriptUpdateParamsMetadataBindingUnion
	for _, b := range bindings {
		switch b.Type {
		case "r2_bucket":
			bs = append(bs, workers.ScriptUpdateParamsMetadataBindingsWorkersBindingKindR2Bucket{
				Name: cf.F(b.Name), BucketName: cf.F(b.Bucket), Type: cf.F(workers.ScriptUpdateParamsMetadataBindingsWorkersBindingKindR2BucketTypeR2Bucket)})
		case "plain_text":
			bs = append(bs, workers.ScriptUpdateParamsMetadataBindingsWorkersBindingKindPlainText{
				Name: cf.F(b.Name), Text: cf.F(b.Text), Type: cf.F(workers.ScriptUpdateParamsMetadataBindingsWorkersBindingKindPlainTextTypePlainText)})
		case "secret_text":
			bs = append(bs, workers.ScriptUpdateParamsMetadataBindingsWorkersBindingKindSecretText{
				Name: cf.F(b.Name), Text: cf.F(b.Text), Type: cf.F(workers.ScriptUpdateParamsMetadataBindingsWorkersBindingKindSecretTextTypeSecretText)})
		default:
			return fmt.Errorf("unknown binding type %q", b.Type)
		}
	}
	_, err := a.c.Workers.Scripts.Update(ctx, script, workers.ScriptUpdateParams{
		AccountID: cf.F(account),
		Metadata: cf.F(workers.ScriptUpdateParamsMetadata{
			MainModule:         cf.F("index.js"),
			CompatibilityDate:  cf.F(compatDate),
			CompatibilityFlags: cf.F(flags),
			Bindings:           cf.F(bs),
		}),
		Files: cf.F([]io.Reader{&namedFile{strings.NewReader(string(code)), "index.js", "application/javascript+module"}}),
	})
	return wrap(err)
}

func (a *api) DeleteWorker(ctx context.Context, account, script string) error {
	_, err := a.c.Workers.Scripts.Delete(ctx, script, workers.ScriptDeleteParams{AccountID: cf.F(account), Force: cf.F(true)})
	return wrap(err)
}

func (a *api) RoutingEnabled(ctx context.Context, zone string) (bool, error) {
	s, err := a.c.EmailRouting.Get(ctx, email_routing.EmailRoutingGetParams{ZoneID: cf.F(zone)})
	if err != nil {
		return false, wrap(err)
	}
	return bool(s.Enabled), nil
}

func (a *api) SetRouting(ctx context.Context, zone, zoneName string, on bool) error {
	var err error
	if on {
		_, err = a.c.EmailRouting.DNS.New(ctx, email_routing.DNSNewParams{ZoneID: cf.F(zone), Name: cf.F(zoneName)})
	} else {
		_, err = a.c.EmailRouting.DNS.Delete(ctx, email_routing.DNSDeleteParams{ZoneID: cf.F(zone)})
	}
	return wrap(err)
}

func (a *api) CatchAllWorker(ctx context.Context, zone string) (string, error) {
	r, err := a.c.EmailRouting.Rules.CatchAlls.Get(ctx, email_routing.RuleCatchAllGetParams{ZoneID: cf.F(zone)})
	if err != nil {
		return "", wrap(err)
	}
	if !bool(r.Enabled) {
		return "", nil
	}
	for _, act := range r.Actions {
		if act.Type == email_routing.CatchAllActionTypeWorker && len(act.Value) > 0 {
			return act.Value[0], nil
		}
	}
	return "", nil
}

func (a *api) SetCatchAll(ctx context.Context, zone, script string) error {
	action := email_routing.CatchAllActionParam{Type: cf.F(email_routing.CatchAllActionTypeDrop)}
	name, enabled := "Disabled by Mails", email_routing.RuleCatchAllUpdateParamsEnabledFalse
	if script != "" {
		action = email_routing.CatchAllActionParam{Type: cf.F(email_routing.CatchAllActionTypeWorker), Value: cf.F([]string{script})}
		name, enabled = "Send everything to Mails", email_routing.RuleCatchAllUpdateParamsEnabledTrue
	}
	_, err := a.c.EmailRouting.Rules.CatchAlls.Update(ctx, email_routing.RuleCatchAllUpdateParams{
		ZoneID:   cf.F(zone),
		Name:     cf.F(name),
		Enabled:  cf.F(enabled),
		Matchers: cf.F([]email_routing.CatchAllMatcherParam{{Type: cf.F(email_routing.CatchAllMatcherTypeAll)}}),
		Actions:  cf.F([]email_routing.CatchAllActionParam{action}),
	})
	return wrap(err)
}

func (a *api) MXCount(ctx context.Context, zone, name string) (int, error) {
	page, err := a.c.DNS.Records.List(ctx, dns.RecordListParams{
		ZoneID: cf.F(zone),
		Name:   cf.F(dns.RecordListParamsName{Exact: cf.F(name)}),
		Type:   cf.F(dns.RecordListParamsTypeMX),
	})
	if err != nil {
		return 0, wrap(err)
	}
	return len(page.Result), nil
}

func (a *api) AddMX(ctx context.Context, zone, name string, mx MX, comment string) error {
	_, err := a.c.DNS.Records.New(ctx, dns.RecordNewParams{
		ZoneID: cf.F(zone),
		Body: dns.MXRecordParam{
			Name: cf.F(name), Content: cf.F(mx.Host), Priority: cf.F(float64(mx.Priority)),
			TTL: cf.F(dns.TTL1), Type: cf.F(dns.MXRecordTypeMX), Comment: cf.F(comment),
		},
	})
	return wrap(err)
}

func (a *api) Destinations(ctx context.Context, account string) ([]Destination, error) {
	var out []Destination
	iter := a.c.EmailRouting.Addresses.ListAutoPaging(ctx, email_routing.AddressListParams{AccountID: cf.F(account)})
	for iter.Next() {
		out = append(out, destination(iter.Current()))
	}
	return out, wrap(iter.Err())
}

func destination(x email_routing.Address) Destination {
	d := Destination{ID: x.ID, Email: strings.ToLower(x.Email)}
	if !x.Verified.IsZero() {
		t := x.Verified
		d.Verified = &t
	}
	return d
}

func (a *api) AddDestination(ctx context.Context, account, email string) (*Destination, error) {
	x, err := a.c.EmailRouting.Addresses.New(ctx, email_routing.AddressNewParams{AccountID: cf.F(account), Email: cf.F(email)})
	if err != nil {
		return nil, wrap(err)
	}
	d := destination(*x)
	return &d, nil
}

func (a *api) DeleteDestination(ctx context.Context, account, id string) error {
	_, err := a.c.EmailRouting.Addresses.Delete(ctx, id, email_routing.AddressDeleteParams{AccountID: cf.F(account)})
	return wrap(err)
}
