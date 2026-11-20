package reporting_test

import (
	"context"
	"slices"
	"testing"

	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/reporting"
)

// fakeAWS is one AWS account's SES and SNS, in memory.
type fakeAWS struct {
	topics, sets map[string]bool
	dest         map[string]*reporting.Destination
	subs         map[string]string // endpoint -> state
}

func newFake() *fakeAWS {
	return &fakeAWS{topics: map[string]bool{}, sets: map[string]bool{}, dest: map[string]*reporting.Destination{}, subs: map[string]string{}}
}

func (f *fakeAWS) EnsureTopic(_ context.Context, name string) (string, error) {
	f.topics[name] = true
	return "arn:aws:sns:us-east-1:123:" + name, nil
}
func (f *fakeAWS) EnsureConfigSet(_ context.Context, name string) error {
	f.sets[name] = true
	return nil
}
func (f *fakeAWS) Destination(_ context.Context, cs string) (*reporting.Destination, bool, error) {
	if !f.sets[cs] {
		return nil, false, nil
	}
	if d := f.dest[cs]; d != nil {
		cp := *d
		return &cp, true, nil
	}
	return nil, true, nil
}
func (f *fakeAWS) PutDestination(_ context.Context, cs string, d reporting.Destination) error {
	f.dest[cs] = &d
	return nil
}
func (f *fakeAWS) Subscription(_ context.Context, _, endpoint string) (string, error) {
	if s, ok := f.subs[endpoint]; ok {
		return s, nil
	}
	return "missing", nil
}
func (f *fakeAWS) Subscribe(_ context.Context, _, endpoint string) error {
	f.subs[endpoint] = "pending"
	return nil
}

func TestSetUpSavesAndKeepsChoices(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	fake := newFake()
	s := &reporting.Service{DB: pool, AWS: fake, AppURL: "https://mail.a.test"}
	if err := s.Load(ctx); err != nil {
		t.Fatal(err)
	}
	if s.ConfigSet() != "" || s.TopicARN() != "" {
		t.Fatal("fresh instance should have no reporting")
	}
	local := &reporting.Service{DB: pool, AWS: fake, AppURL: "http://localhost:3000"}
	if _, err := local.SetUp(ctx); err == nil {
		t.Fatal("set up with a local APP_URL")
	}
	st, err := s.SetUp(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if !st.Active || st.Subscription != "pending" || st.Name != reporting.DefaultName || !slices.Contains(st.Types, "OPEN") {
		t.Fatalf("status = %+v", st)
	}
	if s.ConfigSet() != reporting.DefaultName || s.TopicARN() == "" {
		t.Fatalf("not live: %q %q", s.ConfigSet(), s.TopicARN())
	}
	// A restart reads the saved values.
	again := &reporting.Service{DB: pool, AWS: fake, AppURL: s.AppURL}
	_ = again.Load(ctx)
	if again.TopicARN() != s.TopicARN() {
		t.Fatal("saved topic lost on restart")
	}
	// Choices: required events always stay; a repair keeps the choice.
	if st, err = s.SetEventTypes(ctx, []string{"CLICK"}); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(st.Types, "SEND") || !slices.Contains(st.Types, "CLICK") || slices.Contains(st.Types, "OPEN") {
		t.Fatalf("types = %v", st.Types)
	}
	if _, err := s.SetEventTypes(ctx, []string{"BOGUS"}); err == nil {
		t.Fatal("accepted an unknown event")
	}
	if st, _ = s.SetUp(ctx); !slices.Contains(st.Types, "CLICK") || slices.Contains(st.Types, "OPEN") {
		t.Fatalf("repair reset choices: %v", st.Types)
	}
	// Env wins.
	env := &reporting.Service{DB: pool, AWS: fake, AppURL: s.AppURL, EnvTopicARN: "arn:env"}
	_ = env.Load(ctx)
	if env.TopicARN() != "arn:env" || env.ConfigSet() != reporting.DefaultName {
		t.Fatalf("env override: %q %q", env.TopicARN(), env.ConfigSet())
	}
}
