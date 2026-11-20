// Package events carries what happened (mail received, email sent, ...)
// from the feature that did it to whoever listens, today the webhooks.
// Features depend on this small interface, not on the webhook package.
package events

import "context"

// Event is one occurrence. MailboxID lets a listener scope delivery; Data
// is the JSON payload a webhook receiver gets.
type Event struct {
	Type      string
	MailboxID string
	Data      any
}

// Sink receives events. Emit must not block on the network: a webhook sink
// writes delivery rows and returns.
type Sink interface {
	Emit(ctx context.Context, e Event)
}

// Emit sends e to s when s is set, so a service without listeners (tests)
// needs no stub.
func Emit(ctx context.Context, s Sink, e Event) {
	if s != nil {
		s.Emit(ctx, e)
	}
}

// Recorder is a Sink that keeps events, for tests.
type Recorder struct{ Events []Event }

func (r *Recorder) Emit(_ context.Context, e Event) { r.Events = append(r.Events, e) }

// Types returns the recorded event types in order.
func (r *Recorder) Types() []string {
	out := make([]string, len(r.Events))
	for i, e := range r.Events {
		out[i] = e.Type
	}
	return out
}
