// Package realtime pushes small events to open browser tabs over SSE.
//
// Events carry only what changed ("thread.updated", ids); the client refetches.
// One process, one owner: an in-memory fan-out is enough.
package realtime

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type Event struct {
	Type string `json:"type"`
	Data any    `json:"data,omitempty"`
}

type Hub struct {
	mu        sync.Mutex
	subs      map[chan []byte]struct{}
	done      chan struct{}
	closeOnce sync.Once
}

func NewHub() *Hub { return &Hub{subs: map[chan []byte]struct{}{}, done: make(chan struct{})} }

// Close ends every open stream, so a graceful server shutdown does not wait
// on tabs that would never hang up.
func (h *Hub) Close() { h.closeOnce.Do(func() { close(h.done) }) }

// Publish sends e to every connected tab. A slow tab drops the event rather
// than blocking the sender; it refetches on its next event anyway.
func (h *Hub) Publish(e Event) {
	b, err := json.Marshal(e)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- b:
		default:
		}
	}
}

// ServeHTTP streams events until the client goes away. Mount behind auth.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	ch := make(chan []byte, 16)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.subs, ch)
		h.mu.Unlock()
	}()

	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-h.done:
			return
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case b := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", b)
			flusher.Flush()
		}
	}
}
