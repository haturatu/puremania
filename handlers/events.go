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
	key  string
	data interface{}
}

type eventSubscriber struct {
	mu      sync.Mutex
	pending map[string]serverEvent
	ready   chan struct{}
}

func newEventSubscriber() *eventSubscriber {
	return &eventSubscriber{pending: make(map[string]serverEvent), ready: make(chan struct{}, 1)}
}

func (s *eventSubscriber) enqueue(event serverEvent) {
	key := event.key
	if key == "" {
		key = event.name
	}
	s.mu.Lock()
	s.pending[key] = event
	s.mu.Unlock()
	select {
	case s.ready <- struct{}{}:
	default:
	}
}

func (s *eventSubscriber) drain() []serverEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	events := make([]serverEvent, 0, len(s.pending))
	for key, event := range s.pending {
		events = append(events, event)
		delete(s.pending, key)
	}
	return events
}

type eventBroker struct {
	mu          sync.RWMutex
	subscribers map[*eventSubscriber]struct{}
}

func newEventBroker() *eventBroker {
	return &eventBroker{subscribers: make(map[*eventSubscriber]struct{})}
}

func (b *eventBroker) subscribe() (*eventSubscriber, func()) {
	subscriber := newEventSubscriber()
	b.mu.Lock()
	b.subscribers[subscriber] = struct{}{}
	b.mu.Unlock()
	return subscriber, func() {
		b.mu.Lock()
		delete(b.subscribers, subscriber)
		b.mu.Unlock()
	}
}

func (b *eventBroker) publish(event serverEvent) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for subscriber := range b.subscribers {
		// Per-subscriber mailboxes coalesce repeated invalidations by key. A
		// slow connection receives the latest change without blocking uploads.
		subscriber.enqueue(event)
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

	subscriber, unsubscribe := h.events.subscribe()
	defer unsubscribe()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	var aria2Ticker *time.Ticker
	var aria2Tick <-chan time.Time
	if h.config.Aria2cEnabled && r.URL.Query().Get("aria2") == "1" {
		aria2Ticker = time.NewTicker(2 * time.Second)
		defer aria2Ticker.Stop()
		aria2Tick = aria2Ticker.C
		status := h.collectAria2Event()
		if writeServerEvent(w, serverEvent{name: "aria2", data: status}) != nil {
			return
		}
		flusher.Flush()
	}

	for {
		select {
		case <-r.Context().Done():
			return
		case <-subscriber.ready:
			for _, event := range subscriber.drain() {
				if writeServerEvent(w, event) != nil {
					return
				}
			}
			flusher.Flush()
		case <-aria2Tick:
			status := h.collectAria2Event()
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

func (h *Handler) collectAria2Event() map[string]interface{} {
	status, err := h.collectAria2cStatus()
	if err != nil {
		h.logger.Warn("Aria2c status stream is incomplete", "error", err)
		status["error"] = err.Error()
	}
	return status
}

func (h *Handler) publishUploadState(session *uploadSession, _ bool) {
	h.events.publish(serverEvent{
		name: "upload",
		key:  "upload:" + session.ID,
		// SSE is an invalidation hint. The browser reloads authoritative state
		// through the upload session REST endpoint before rendering it.
		data: map[string]string{"uploadId": session.ID},
	})
}
