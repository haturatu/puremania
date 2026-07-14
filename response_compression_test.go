package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/andybalholm/brotli"
)

func TestResponseCompressionNegotiatesBrotliForJSON(t *testing.T) {
	handler := responseCompressionMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = w.Write([]byte(`{"items":["repeated value repeated value repeated value"]}`))
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/files", nil)
	req.Header.Set("Accept-Encoding", "gzip, br")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if got := res.Header().Get("Content-Encoding"); got != "br" {
		t.Fatalf("Content-Encoding = %q, want br", got)
	}
	if got := res.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Fatalf("Vary = %q, want Accept-Encoding", got)
	}
	decoded, err := io.ReadAll(brotli.NewReader(bytes.NewReader(res.Body.Bytes())))
	if err != nil {
		t.Fatalf("decode Brotli response: %v", err)
	}
	if got, want := string(decoded), `{"items":["repeated value repeated value repeated value"]}`; got != want {
		t.Fatalf("decoded response = %q, want %q", got, want)
	}
}

func TestResponseCompressionHonorsGzipQuality(t *testing.T) {
	handler := responseCompressionMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/css")
		_, _ = w.Write([]byte(".item { color: red; color: red; color: red; }"))
	}))

	req := httptest.NewRequest(http.MethodGet, "/static/app.css", nil)
	req.Header.Set("Accept-Encoding", "br;q=0.2, gzip;q=0.9")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if got := res.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	reader, err := gzip.NewReader(bytes.NewReader(res.Body.Bytes()))
	if err != nil {
		t.Fatalf("open gzip response: %v", err)
	}
	defer reader.Close()
	if _, err := io.ReadAll(reader); err != nil {
		t.Fatalf("decode gzip response: %v", err)
	}
}

func TestResponseCompressionSkipsRangesAndBinary(t *testing.T) {
	handler := responseCompressionMiddleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("binary response"))
	}))

	for _, request := range []*http.Request{
		httptest.NewRequest(http.MethodGet, "/api/files/content", nil),
		func() *http.Request {
			req := httptest.NewRequest(http.MethodGet, "/api/files/download", nil)
			req.Header.Set("Range", "bytes=0-9")
			return req
		}(),
	} {
		request.Header.Set("Accept-Encoding", "br, gzip")
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, request)
		if got := res.Header().Get("Content-Encoding"); got != "" {
			t.Fatalf("Content-Encoding = %q, want no compression", got)
		}
	}
}
