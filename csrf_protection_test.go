package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newCSRFTestHandler() http.Handler {
	probe := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	return csrfProtectionMiddleware(probe)
}

func TestCSRFRejectsCrossSiteFetchSite(t *testing.T) {
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/files/delete", strings.NewReader(`{"paths":["/"]}`))
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	newCSRFTestHandler().ServeHTTP(res, req)
	if res.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusForbidden)
	}
}

func TestCSRFRejectsTextPlainJSONBody(t *testing.T) {
	// A cross-origin "simple request" can carry a JSON payload with
	// Content-Type: text/plain and never trigger a CORS preflight.
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/files/delete", strings.NewReader(`{"paths":["/"]}`))
	req.Header.Set("Content-Type", "text/plain")
	newCSRFTestHandler().ServeHTTP(res, req)
	if res.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusUnsupportedMediaType)
	}
}

func TestCSRFAllowsJSONContentType(t *testing.T) {
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/files/delete", strings.NewReader(`{"paths":["/"]}`))
	req.Header.Set("Content-Type", "application/json")
	newCSRFTestHandler().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusOK)
	}
}

func TestCSRFAllowsVendorJSONContentType(t *testing.T) {
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/files/delete", strings.NewReader(`{"paths":["/"]}`))
	req.Header.Set("Content-Type", "application/vnd.api+json")
	newCSRFTestHandler().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusOK)
	}
}

func TestCSRFAllowsStreamingEndpointsWithoutJSON(t *testing.T) {
	for _, tc := range []struct {
		method, path, contentType string
	}{
		{http.MethodPut, "/api/files/upload-sessions/abc/chunks", "application/octet-stream"},
		{http.MethodPost, "/api/files/upload", "multipart/form-data; boundary=x"},
	} {
		res := httptest.NewRecorder()
		req := httptest.NewRequest(tc.method, tc.path, nil)
		req.Header.Set("Content-Type", tc.contentType)
		newCSRFTestHandler().ServeHTTP(res, req)
		if res.Code != http.StatusOK {
			t.Errorf("%s %s status = %d, want %d", tc.method, tc.path, res.Code, http.StatusOK)
		}
	}
}

func TestCSRFAllowsBodylessDelete(t *testing.T) {
	res := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/files/upload-sessions/abcdef", nil)
	newCSRFTestHandler().ServeHTTP(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusOK)
	}
}

func TestCSRFAllowsReadOnlyMethods(t *testing.T) {
	res := httptest.NewRecorder()
	newCSRFTestHandler().ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/api/files", nil))
	if res.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want %d", res.Code, http.StatusOK)
	}
}
