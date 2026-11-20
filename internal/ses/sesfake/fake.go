// Package sesfake is an in-memory ses.Client for tests.
package sesfake

import (
	"context"
	"fmt"
	"sort"
	"sync"

	"github.com/shahriyardx/mails/internal/ses"
)

// Fake records calls and keeps identities in a map. Set Err* fields to make
// the next matching call fail.
type Fake struct {
	mu          sync.Mutex
	Identities  map[string]*ses.Identity
	Sent        []ses.RawEmail
	Deleted     []string
	SendErr     error
	MailFromErr error
	AccountInfo *ses.Account
	n           int
}

func New() *Fake { return &Fake{Identities: map[string]*ses.Identity{}} }

var _ ses.Client = (*Fake)(nil)

// Verify marks an identity verified and sendable, as SES does once DNS is in.
func (f *Fake) Verify(name string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if id := f.Identities[name]; id != nil {
		id.VerificationStatus, id.SendingEnabled, id.DKIMStatus = "SUCCESS", true, "SUCCESS"
		if id.MailFromDomain != "" {
			id.MailFromStatus = "SUCCESS"
		}
	}
}

func (f *Fake) GetIdentity(_ context.Context, name string) (*ses.Identity, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	id, ok := f.Identities[name]
	if !ok {
		return nil, nil
	}
	cp := *id
	return &cp, nil
}

func (f *Fake) ListIdentities(context.Context) ([]ses.Identity, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]ses.Identity, 0, len(f.Identities))
	for _, id := range f.Identities {
		out = append(out, *id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (f *Fake) CreateIdentity(_ context.Context, name string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.Identities[name]; ok {
		return fmt.Errorf("identity %s already exists", name)
	}
	f.Identities[name] = &ses.Identity{Name: name, Type: "DOMAIN", VerificationStatus: "PENDING", DKIMStatus: "PENDING", DKIMOrigin: "AWS_SES", DKIMTokens: []string{"tok1", "tok2", "tok3"}}
	return nil
}

func (f *Fake) DeleteIdentity(_ context.Context, name string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.Identities, name)
	f.Deleted = append(f.Deleted, name)
	return nil
}

func (f *Fake) PutExternalDKIM(_ context.Context, domain, selector, _ string) (string, []string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	id := f.Identities[domain]
	if id == nil {
		return "", nil, fmt.Errorf("no identity %s", domain)
	}
	id.DKIMOrigin, id.DKIMTokens, id.DKIMStatus = "EXTERNAL", []string{selector}, "PENDING"
	return "PENDING", []string{selector}, nil
}

func (f *Fake) SetMailFrom(_ context.Context, domain, mailFrom string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.MailFromErr != nil {
		return f.MailFromErr
	}
	if id := f.Identities[domain]; id != nil {
		id.MailFromDomain, id.MailFromStatus = mailFrom, "PENDING"
	}
	return nil
}

// SendRaw fails like the AWS client when ctx is already done.
func (f *Fake) SendRaw(ctx context.Context, m ses.RawEmail) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", fmt.Errorf("ses send: %w", err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.SendErr != nil {
		return "", f.SendErr
	}
	f.Sent = append(f.Sent, m)
	f.n++
	return fmt.Sprintf("ses-%d", f.n), nil
}

func (f *Fake) Account(context.Context) (*ses.Account, error) {
	if f.AccountInfo != nil {
		return f.AccountInfo, nil
	}
	return &ses.Account{EnforcementStatus: "HEALTHY", Max24Hour: 200, MaxSendRate: 1}, nil
}

// SentCount is len(Sent) under the lock.
func (f *Fake) SentCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.Sent)
}
