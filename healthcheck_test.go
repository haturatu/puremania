package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRunHealthcheckURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer server.Close()
	if code := runHealthcheckURL(server.URL, &bytes.Buffer{}); code != 0 {
		t.Fatalf("healthcheck exit code = %d", code)
	}
}

func TestRunHealthcheckURLRejectsUnexpectedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"unhealthy"}`))
	}))
	defer server.Close()
	if code := runHealthcheckURL(server.URL, &bytes.Buffer{}); code != 1 {
		t.Fatalf("healthcheck exit code = %d, want 1", code)
	}
}
