package idempotency_test

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/idempotency"
)

func TestDoRunsOnce(t *testing.T) {
	s := &idempotency.Store{DB: dbtest.New(t)}
	ctx := context.Background()
	var runs atomic.Int32
	fn := func() (int, any, error) { runs.Add(1); return 202, map[string]string{"id": "msg_1"}, nil }

	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Do(ctx, "key_1", "k", "/emails", []byte(`{"a":1}`), fn); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if runs.Load() != 1 {
		t.Fatalf("ran %d times", runs.Load())
	}
	r, err := s.Do(ctx, "key_1", "k", "/emails", []byte(`{"a":1}`), fn)
	if err != nil || !r.Replayed || r.Status != 202 || string(r.Body) != `{"id": "msg_1"}` && string(r.Body) != `{"id":"msg_1"}` {
		t.Fatalf("replay = %+v %v", r, err)
	}
	var e *httpx.Error
	if _, err := s.Do(ctx, "key_1", "k", "/emails", []byte(`{"a":2}`), fn); !errors.As(err, &e) || e.Status != 409 {
		t.Fatalf("different body: %v", err)
	}
	// Another caller's same key is its own.
	if r, _ := s.Do(ctx, "key_2", "k", "/emails", []byte(`{"a":2}`), fn); r.Replayed {
		t.Fatal("keys leak between callers")
	}
	// Failures are not stored.
	fail := func() (int, any, error) { return 0, nil, errors.New("boom") }
	if _, err := s.Do(ctx, "key_1", "f", "/emails", nil, fail); err == nil {
		t.Fatal("error swallowed")
	}
	if r, _ := s.Do(ctx, "key_1", "f", "/emails", nil, fn); r.Replayed {
		t.Fatal("failure was stored")
	}
}
