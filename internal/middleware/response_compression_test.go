package middleware

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/andybalholm/brotli"
)

func decodeCompressedResponse(t *testing.T, encoding string, response *httptest.ResponseRecorder) string {
	t.Helper()
	var reader io.Reader = brotli.NewReader(bytes.NewReader(response.Body.Bytes()))
	if encoding == "gzip" {
		gzipReader, err := gzip.NewReader(bytes.NewReader(response.Body.Bytes()))
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = gzipReader.Close() }()
		reader = gzipReader
	}
	decoded, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	return string(decoded)
}

func TestResponseCompressionReusedWriters(t *testing.T) {
	for _, encoding := range []string{"gzip", "br"} {
		t.Run(encoding, func(t *testing.T) {
			// Parallel subtests also exercise pool ownership under concurrent requests.
			for stream := range 8 {
				t.Run(fmt.Sprint(stream), func(t *testing.T) {
					t.Parallel()
					for request := range 12 {
						body := strings.Repeat(fmt.Sprintf("stream=%d request=%d;", stream, request), 1+request*512)
						handler := ResponseCompression(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
							w.Header().Set("Content-Type", "text/plain")
							if request%2 == 0 {
								_, _ = w.Write([]byte(body[:len(body)/2]))
								w.(http.Flusher).Flush()
								_, _ = w.Write([]byte(body[len(body)/2:]))
							} else {
								_, _ = w.(io.ReaderFrom).ReadFrom(strings.NewReader(body))
							}
						}))
						req := httptest.NewRequest(http.MethodGet, "/", nil)
						req.Header.Set("Accept-Encoding", encoding)
						res := httptest.NewRecorder()
						handler.ServeHTTP(res, req)
						if got := decodeCompressedResponse(t, encoding, res); got != body {
							t.Fatal("response contains stale or truncated data")
						}
					}
				})
			}
		})
	}
}

type failedCompressionResponse struct{ *httptest.ResponseRecorder }

func (failedCompressionResponse) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }

func TestResponseCompressionRecoversAfterFailedResponses(t *testing.T) {
	for _, encoding := range []string{"gzip", "br"} {
		t.Run(encoding, func(t *testing.T) {
			for _, failure := range []string{"write", "panic"} {
				req := httptest.NewRequest(http.MethodGet, "/", nil)
				req.Header.Set("Accept-Encoding", encoding)
				res := httptest.NewRecorder()
				beforePanic := 0
				handler := ResponseCompression(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					w.Header().Set("Content-Type", "text/plain")
					_, _ = w.Write([]byte("unfinished response"))
					if failure == "panic" {
						beforePanic = res.Body.Len()
						panic(http.ErrAbortHandler)
					}
				}))
				if failure == "panic" {
					func() {
						defer func() {
							if got := recover(); got != http.ErrAbortHandler {
								t.Fatalf("panic = %v, want ErrAbortHandler", got)
							}
						}()
						handler.ServeHTTP(res, req)
					}()
					if res.Body.Len() != beforePanic {
						t.Fatal("panic cleanup wrote to the failed response")
					}
				} else {
					handler.ServeHTTP(failedCompressionResponse{res}, req)
				}
				good := ResponseCompression(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					w.Header().Set("Content-Type", "text/plain")
					_, _ = w.Write([]byte("complete response"))
				}))
				res = httptest.NewRecorder()
				good.ServeHTTP(res, req)
				if got := decodeCompressedResponse(t, encoding, res); got != "complete response" {
					t.Fatalf("response after %s = %q", failure, got)
				}
			}
		})
	}
}

func TestResponseCompressionNegotiatesBrotliForJSON(t *testing.T) {
	handler := ResponseCompression(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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
	handler := ResponseCompression(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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
	defer func() { _ = reader.Close() }()
	if _, err := io.ReadAll(reader); err != nil {
		t.Fatalf("decode gzip response: %v", err)
	}
}

func TestResponseCompressionSkipsRangesAndBinary(t *testing.T) {
	handler := ResponseCompression(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
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

func TestResponseCompressionVaryAndFlushForIdentityResponse(t *testing.T) {
	flushed := false
	handler := ResponseCompression(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if _, ok := w.(http.Flusher); !ok {
			t.Fatal("compression writer does not preserve http.Flusher")
		}
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("stream"))
		w.(http.Flusher).Flush()
		flushed = true
	}))

	res := httptest.NewRecorder()
	handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/stream", nil))
	if !flushed {
		t.Fatal("handler did not flush")
	}
	if got := res.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Fatalf("Vary = %q, want Accept-Encoding", got)
	}
}
