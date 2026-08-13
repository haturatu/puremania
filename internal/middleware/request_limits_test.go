package middleware

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRequestBodyLimitMiddlewareRejectsOversizedJSON(t *testing.T) {
	handler := RequestBodyLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.Copy(io.Discard, r.Body); err != nil {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/files/delete", bytes.NewReader(bytes.Repeat([]byte("x"), maxJSONBodyBytes+1)))
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)
	if res.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusRequestEntityTooLarge)
	}
}

func TestRequestBodyLimitMiddlewarePreservesStreamingEndpoints(t *testing.T) {
	handler := RequestBodyLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.Copy(io.Discard, r.Body); err != nil {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	body := bytes.Repeat([]byte("x"), maxJSONBodyBytes+1)
	for _, path := range []string{"/api/files/upload", "/api/files/upload-sessions/id/chunks"} {
		req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != http.StatusNoContent {
			t.Fatalf("path %s: status = %d, want %d", path, res.Code, http.StatusNoContent)
		}
	}
}
