// Package cffake is an in-memory cloudflare.API for tests.
package cffake

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/shahriyardx/mails/internal/cloudflare"
)

// Fake is one Cloudflare account. Set BadToken to refuse every call with
// code 10000.
type Fake struct {
	mu       sync.Mutex
	BadToken bool
	ZoneList []cloudflare.Zone
	Routing  map[string]bool
	CatchAll map[string]string
	MX       map[string][]cloudflare.MX // by record name
	Dests    []cloudflare.Destination
	Uploaded []cloudflare.Binding
	Script   []byte
	WorkerAt *time.Time
	Tokens   []string
}

func New(zones ...cloudflare.Zone) *Fake {
	return &Fake{ZoneList: zones, Routing: map[string]bool{}, CatchAll: map[string]string{}, MX: map[string][]cloudflare.MX{}}
}

// For returns a constructor for Service.NewAPI that records tokens.
func (f *Fake) For(token string) cloudflare.API {
	f.mu.Lock()
	f.Tokens = append(f.Tokens, token)
	f.mu.Unlock()
	return f
}

func (f *Fake) check() error {
	if f.BadToken {
		return &cloudflare.Error{Codes: []int{10000}, Message: "Authentication error"}
	}
	return nil
}

func (f *Fake) VerifyToken(context.Context) error { return f.check() }

func (f *Fake) Zones(context.Context) ([]cloudflare.Zone, error) { return f.ZoneList, f.check() }

func (f *Fake) WorkerModified(context.Context, string, string) (*time.Time, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.WorkerAt, f.check()
}

func (f *Fake) UploadWorker(_ context.Context, _, _ string, code []byte, _ string, _ []string, b []cloudflare.Binding) error {
	if err := f.check(); err != nil {
		return err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	now := time.Now()
	f.Uploaded, f.Script, f.WorkerAt = b, code, &now
	return nil
}

func (f *Fake) DeleteWorker(context.Context, string, string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.WorkerAt = nil
	return f.check()
}

func (f *Fake) RoutingEnabled(_ context.Context, zone string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.Routing[zone], f.check()
}

func (f *Fake) SetRouting(_ context.Context, zone, _ string, on bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Routing[zone] = on
	return f.check()
}

func (f *Fake) CatchAllWorker(_ context.Context, zone string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.CatchAll[zone], f.check()
}

func (f *Fake) SetCatchAll(_ context.Context, zone, script string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.CatchAll[zone] = script
	return f.check()
}

func (f *Fake) MXCount(_ context.Context, _, name string) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.MX[name]), f.check()
}

func (f *Fake) AddMX(_ context.Context, _, name string, mx cloudflare.MX, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.MX[name] = append(f.MX[name], mx)
	return f.check()
}

func (f *Fake) Destinations(context.Context, string) ([]cloudflare.Destination, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]cloudflare.Destination(nil), f.Dests...), f.check()
}

func (f *Fake) AddDestination(_ context.Context, _, email string) (*cloudflare.Destination, error) {
	if err := f.check(); err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	d := cloudflare.Destination{ID: fmt.Sprintf("dst_%d", len(f.Dests)+1), Email: email}
	f.Dests = append(f.Dests, d)
	return &d, nil
}

func (f *Fake) DeleteDestination(_ context.Context, _, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i, d := range f.Dests {
		if d.ID == id {
			f.Dests = append(f.Dests[:i], f.Dests[i+1:]...)
		}
	}
	return f.check()
}
