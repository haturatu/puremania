package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSecurityHeadersMiddleware(t *testing.T) {
	handler := securityHeadersMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	res := httptest.NewRecorder()
	handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/", nil))

	want := map[string]string{
		"X-Content-Type-Options":  "nosniff",
		"X-Frame-Options":         "DENY",
		"Content-Security-Policy": contentSecurityPolicy,
		"Referrer-Policy":         "no-referrer",
		"Permissions-Policy":      "camera=(), microphone=(), geolocation=()",
	}
	for header, expected := range want {
		if got := res.Header().Get(header); got != expected {
			t.Errorf("%s = %q, want %q", header, got, expected)
		}
	}
}
