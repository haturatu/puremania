package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func BenchmarkResponseCompression(b *testing.B) {
	for _, encoding := range []string{"gzip", "br"} {
		for _, size := range []int{1024, 32768} {
			b.Run(fmt.Sprintf("%s/%d", encoding, size), func(b *testing.B) {
				body := []byte(strings.Repeat(`{"name":"Photo-000123.JPG","path":"/album/Photo-000123.JPG","size":123456},`, size/72+1))[:size]
				handler := ResponseCompression(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write(body)
				}))
				req := httptest.NewRequest("GET", "/api/files", nil)
				req.Header.Set("Accept-Encoding", encoding)
				b.ReportAllocs()
				b.SetBytes(int64(len(body)))
				b.ResetTimer()
				for b.Loop() {
					handler.ServeHTTP(httptest.NewRecorder(), req)
				}
			})
		}
	}
}
