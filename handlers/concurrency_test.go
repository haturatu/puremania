package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTryAcquireIsBoundedAndReleases(t *testing.T) {
	gate := make(chan struct{}, 1)
	if !tryAcquire(gate) {
		t.Fatal("first acquire failed")
	}
	if tryAcquire(gate) {
		t.Fatal("second acquire exceeded gate capacity")
	}
	release(gate)
	if !tryAcquire(gate) {
		t.Fatal("acquire after release failed")
	}
}

func TestRespondBusyIsRetryable(t *testing.T) {
	res := httptest.NewRecorder()
	respondBusy(res)
	if res.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusTooManyRequests)
	}
	if got := res.Header().Get("Retry-After"); got != "5" {
		t.Fatalf("Retry-After = %q, want 5", got)
	}
}
