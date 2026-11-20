package realtime

import (
	"net/http/httptest"
	"testing"
	"time"
)

// Close ends open streams, so server shutdown does not wait on them.
func TestCloseEndsStreams(t *testing.T) {
	h := NewHub()
	done := make(chan struct{})
	go func() {
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/api/events", nil))
		close(done)
	}()
	h.Close()
	h.Close() // twice is fine
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("stream still open after Close")
	}
}
