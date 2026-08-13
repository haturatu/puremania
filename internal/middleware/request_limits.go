package middleware

import (
	"net/http"
	"strings"
)

const (
	maxJSONBodyBytes = 1 << 20
	maxSaveBodyBytes = 11 << 20
)

// RequestBodyLimit bounds API request bodies before they reach JSON
// decoders. Large binary upload endpoints retain their own streaming limits.
func RequestBodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body != nil && strings.HasPrefix(r.URL.Path, "/api/") &&
			r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions &&
			r.URL.Path != "/api/files/upload" && !strings.HasSuffix(r.URL.Path, "/chunks") {
			limit := int64(maxJSONBodyBytes)
			if r.URL.Path == "/api/files/save" {
				limit = maxSaveBodyBytes
			}
			r.Body = http.MaxBytesReader(w, r.Body, limit)
		}
		next.ServeHTTP(w, r)
	})
}
