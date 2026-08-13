package handlers

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"puremania/types"
)

type cancelOnFlushRecorder struct {
	*httptest.ResponseRecorder
	cancel context.CancelFunc
}

func (r *cancelOnFlushRecorder) Flush() { r.cancel() }

func TestWriteServerEventUsesNamedSSEFrame(t *testing.T) {
	response := httptest.NewRecorder()
	if err := writeServerEvent(response, serverEvent{name: "upload", data: map[string]int{"uploadedBytes": 8}}); err != nil {
		t.Fatal(err)
	}
	if got := response.Body.String(); got != "event: upload\ndata: {\"uploadedBytes\":8}\n\n" {
		t.Fatalf("unexpected SSE frame: %q", got)
	}
}

func TestEventBrokerPublishesToSubscribers(t *testing.T) {
	broker := newEventBroker()
	events, unsubscribe := broker.subscribe()
	defer unsubscribe()
	want := serverEvent{name: "upload", data: "changed"}
	broker.publish(want)
	<-events.ready
	if got := events.drain()[0]; got.name != want.name || got.data != want.data {
		t.Fatalf("unexpected event: %#v", got)
	}
}

func TestEventBrokerCoalescesWithoutDroppingLatestInvalidations(t *testing.T) {
	broker := newEventBroker()
	events, unsubscribe := broker.subscribe()
	defer unsubscribe()
	for uploaded := 0; uploaded < 1000; uploaded++ {
		broker.publish(serverEvent{name: "upload", key: "upload:id", data: uploaded})
	}
	<-events.ready
	pending := events.drain()
	if len(pending) != 1 || pending[0].data != 999 {
		t.Fatalf("expected latest coalesced invalidation, got %#v", pending)
	}
}

func TestEventsSetsStreamingHeadersAndStopsOnDisconnect(t *testing.T) {
	config := &types.Config{StorageDir: t.TempDir()}
	handler := NewHandler(config, slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest("GET", "/api/events", nil)
	ctx, cancel := context.WithCancel(request.Context())
	request = request.WithContext(ctx)
	response := &cancelOnFlushRecorder{ResponseRecorder: httptest.NewRecorder(), cancel: cancel}

	handler.Events(response, request)

	if got := response.Header().Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("Content-Type = %q", got)
	}
	if cacheControl := response.Header().Get("Cache-Control"); !strings.Contains(cacheControl, "no-transform") {
		t.Fatalf("Cache-Control = %q", cacheControl)
	}
	if !strings.Contains(response.Body.String(), ": connected") {
		t.Fatalf("missing connection prelude: %q", response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "event: sync\ndata: {}\n\n") {
		t.Fatalf("missing initial reconciliation event: %q", response.Body.String())
	}
}

func TestUploadEventDoesNotExposePaths(t *testing.T) {
	config := &types.Config{StorageDir: t.TempDir()}
	handler := NewHandler(config, slog.New(slog.NewTextHandler(io.Discard, nil)))
	events, unsubscribe := handler.events.subscribe()
	defer unsubscribe()
	handler.publishUploadState(&uploadSession{ID: "id", Destination: "/secret", RelativePath: "file.txt", UploadedBytes: 4, TotalBytes: 8}, false)
	<-events.ready
	event := events.drain()[0]
	encoded, err := json.Marshal(event.data)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "secret") || strings.Contains(string(encoded), "file.txt") {
		t.Fatalf("upload event leaked a path: %s", encoded)
	}
	if string(encoded) != `{"uploadId":"id"}` {
		t.Fatalf("upload event must be an invalidation only: %s", encoded)
	}
}
