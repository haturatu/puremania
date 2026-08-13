package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type serverEvent struct {
	name string
	data interface{}
}

type eventBroker struct {
	mu          sync.RWMutex
	subscribers map[chan serverEvent]struct{}
}

func newEventBroker() *eventBroker {
	return &eventBroker{subscribers: make(map[chan serverEvent]struct{})}
}

func (b *eventBroker) subscribe() (<-chan serverEvent, func()) {
	ch := make(chan serverEvent, 32)
	b.mu.Lock()
	b.subscribers[ch] = struct{}{}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		delete(b.subscribers, ch)
		b.mu.Unlock()
	}
}

func (b *eventBroker) publish(event serverEvent) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for subscriber := range b.subscribers {
		select {
		case subscriber <- event:
		default:
			// A slow tab can recover from the next state snapshot. Never let it
			// apply backpressure to upload writes or other request handlers.
		}
	}
}

func writeServerEvent(w http.ResponseWriter, event serverEvent) error {
	data, err := json.Marshal(event.data)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.name, data)
	return err
}

// Events streams server-side state changes to the browser. Upload mutations
// are pushed by their handlers; aria2c is sampled only while a browser has an
// active stream because its JSON-RPC API does not provide HTTP notifications.
func (h *Handler) Events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		h.respondError(w, "Streaming is unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	events, unsubscribe := h.events.subscribe()
	defer unsubscribe()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	var aria2Ticker *time.Ticker
	var aria2Tick <-chan time.Time
	if h.config.Aria2cEnabled && r.URL.Query().Get("aria2") == "1" {
		aria2Ticker = time.NewTicker(2 * time.Second)
		defer aria2Ticker.Stop()
		aria2Tick = aria2Ticker.C
		status, _ := h.collectAria2cStatus()
		if writeServerEvent(w, serverEvent{name: "aria2", data: status}) != nil {
			return
		}
		flusher.Flush()
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-events:
			if writeServerEvent(w, event) != nil {
				return
			}
			flusher.Flush()
		case <-aria2Tick:
			status, _ := h.collectAria2cStatus()
			if writeServerEvent(w, serverEvent{name: "aria2", data: status}) != nil {
				return
			}
			flusher.Flush()
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": keepalive\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (h *Handler) publishUploadState(session *uploadSession, deleted bool) {
	h.events.publish(serverEvent{name: "upload", data: map[string]interface{}{
		"uploadId":      session.ID,
		"uploadedBytes": session.UploadedBytes,
		"totalBytes":    session.TotalBytes,
		"completed":     session.Completed,
		"deleted":       deleted,
	}})
}
