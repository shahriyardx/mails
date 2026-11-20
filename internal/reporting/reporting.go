// Package reporting sets up SES delivery reporting: a configuration set
// whose events go to an SNS topic, and that topic's HTTPS subscription to
// /api/ses/events. It also holds the configuration set and topic in use,
// which the send path and the SNS endpoint read.
package reporting

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync/atomic"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/ses"
)

// DefaultName is the configuration set and topic name used when none is set.
const DefaultName = "mails-events"

// Required events: without them a message's fate is unknown.
var Required = []string{"SEND", "DELIVERY", "BOUNCE", "COMPLAINT", "REJECT"}

// Optional events. OPEN and CLICK change the message: SES adds a tracking
// image or rewrites links.
var Optional = []string{"DELIVERY_DELAY", "RENDERING_FAILURE", "OPEN", "CLICK"}

// defaults is what a first setup turns on.
var defaults = append(slices.Clone(Required), "DELIVERY_DELAY", "RENDERING_FAILURE", "OPEN")

type current struct{ configSet, topicARN string }

// Service manages reporting. EnvConfigSet and EnvTopicARN, when set, win
// over what the dashboard saved.
type Service struct {
	DB           *pgxpool.Pool
	AWS          AWS
	AppURL       string
	EnvConfigSet string
	EnvTopicARN  string

	cur atomic.Pointer[current]
}

// Load reads the saved values. Call once at start, before serving.
func (s *Service) Load(ctx context.Context) error {
	var cs, topic *string
	if err := s.DB.QueryRow(ctx, `SELECT ses_configuration_set, ses_sns_topic_arn FROM settings WHERE id = 1`).Scan(&cs, &topic); err != nil {
		return fmt.Errorf("load reporting settings: %w", err)
	}
	s.set(deref(cs), deref(topic))
	return nil
}

func (s *Service) set(configSet, topic string) {
	if s.EnvConfigSet != "" {
		configSet = s.EnvConfigSet
	}
	if s.EnvTopicARN != "" {
		topic = s.EnvTopicARN
	}
	s.cur.Store(&current{configSet, topic})
}

func (s *Service) get() current {
	if c := s.cur.Load(); c != nil {
		return *c
	}
	return current{s.EnvConfigSet, s.EnvTopicARN}
}

// ConfigSet is the configuration set to send with ("" for none).
func (s *Service) ConfigSet() string { return s.get().configSet }

// TopicARN is the only SNS topic /api/ses/events accepts ("" refuses all).
func (s *Service) TopicARN() string { return s.get().topicARN }

func (s *Service) endpoint() string { return strings.TrimRight(s.AppURL, "/") + "/api/ses/events" }

func (s *Service) name() string {
	if cs := s.ConfigSet(); cs != "" {
		return cs
	}
	return DefaultName
}

// Status is what the reporting page shows.
type Status struct {
	Name             string   `json:"name"`
	Endpoint         string   `json:"endpoint"`
	ConfigurationSet bool     `json:"configuration_set"`
	Destination      bool     `json:"destination"`
	Types            []string `json:"types"`
	TopicARN         string   `json:"topic_arn"`
	Subscription     string   `json:"subscription"` // confirmed, pending, missing
	Active           bool     `json:"active"`       // the server is sending with it and accepting its events
	Required         []string `json:"required"`
	Optional         []string `json:"optional"`
	EnvManaged       bool     `json:"env_managed"`
	Error            string   `json:"error,omitempty"`
}

// Status asks AWS where reporting stands. AWS being unreachable is
// reported in Error, not returned.
func (s *Service) Status(ctx context.Context) (*Status, error) {
	st := &Status{Name: s.name(), Endpoint: s.endpoint(), TopicARN: s.TopicARN(), Subscription: "missing",
		Types: []string{}, Required: Required, Optional: Optional,
		EnvManaged: s.EnvConfigSet != "" || s.EnvTopicARN != ""}
	dest, exists, err := s.AWS.Destination(ctx, st.Name)
	if err != nil {
		st.Error = ses.Explain(err)
		return st, nil
	}
	st.ConfigurationSet = exists
	if dest != nil {
		st.Destination, st.Types = dest.Enabled, nonNil(dest.Types)
		if st.TopicARN == "" {
			st.TopicARN = dest.TopicARN
		}
	}
	if st.TopicARN != "" {
		if st.Subscription, err = s.AWS.Subscription(ctx, st.TopicARN, st.Endpoint); err != nil {
			st.Error = ses.Explain(err)
		}
	}
	st.Active = s.ConfigSet() != "" && s.TopicARN() != "" && st.Destination
	return st, nil
}

// SetUp creates (or repairs) the whole chain and saves it, so sending uses
// the configuration set and the SNS endpoint accepts the topic at once.
// Safe to run again.
func (s *Service) SetUp(ctx context.Context) (*Status, error) {
	if strings.Contains(s.AppURL, "localhost") || strings.Contains(s.AppURL, "127.0.0.1") || !strings.HasPrefix(s.AppURL, "https://") {
		return nil, httpx.Invalid("", "APP_URL must be a public https address: SNS has to reach "+s.endpoint())
	}
	name := s.name()
	topic, err := s.AWS.EnsureTopic(ctx, name)
	if err != nil {
		return nil, upstream(err)
	}
	if err := s.AWS.EnsureConfigSet(ctx, name); err != nil {
		return nil, upstream(err)
	}
	types := defaults
	if dest, _, err := s.AWS.Destination(ctx, name); err != nil {
		return nil, upstream(err)
	} else if dest != nil && len(dest.Types) > 0 {
		types = withRequired(dest.Types) // keep the owner's choices on a repair
	}
	if err := s.AWS.PutDestination(ctx, name, Destination{Enabled: true, Types: types, TopicARN: topic}); err != nil {
		return nil, upstream(err)
	}
	// Save before subscribing: SNS calls the endpoint at once to confirm,
	// and the endpoint only accepts the saved topic.
	if err := s.save(ctx, name, topic); err != nil {
		return nil, err
	}
	sub, err := s.AWS.Subscription(ctx, topic, s.endpoint())
	if err != nil {
		return nil, upstream(err)
	}
	if sub == "missing" {
		if err := s.AWS.Subscribe(ctx, topic, s.endpoint()); err != nil {
			return nil, upstream(err)
		}
	}
	return s.Status(ctx)
}

// SetEventTypes chooses the optional events; the required ones always stay.
func (s *Service) SetEventTypes(ctx context.Context, types []string) (*Status, error) {
	for _, t := range types {
		if !slices.Contains(Required, t) && !slices.Contains(Optional, t) {
			return nil, httpx.Invalid("types", "types: Unknown event "+t)
		}
	}
	name := s.name()
	dest, _, err := s.AWS.Destination(ctx, name)
	if err != nil {
		return nil, upstream(err)
	}
	if dest == nil {
		return nil, httpx.Invalid("", "Set up reporting first")
	}
	dest.Types = withRequired(types)
	if err := s.AWS.PutDestination(ctx, name, *dest); err != nil {
		return nil, upstream(err)
	}
	return s.Status(ctx)
}

func (s *Service) save(ctx context.Context, configSet, topic string) error {
	if _, err := s.DB.Exec(ctx, `UPDATE settings SET ses_configuration_set = $1, ses_sns_topic_arn = $2, updated_at = now() WHERE id = 1`,
		configSet, topic); err != nil {
		return fmt.Errorf("save reporting settings: %w", err)
	}
	s.set(configSet, topic)
	return nil
}

// withRequired returns types with every required event, in a fixed order.
func withRequired(types []string) []string {
	var out []string
	for _, t := range append(slices.Clone(Required), Optional...) {
		if slices.Contains(Required, t) || slices.Contains(types, t) {
			out = append(out, t)
		}
	}
	return out
}

func upstream(err error) error {
	return &httpx.Error{Status: 502, Code: "upstream_error", Message: ses.Explain(err)}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
