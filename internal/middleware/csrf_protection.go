package middleware

import (
	"encoding/json"
	"mime"
	"net/http"
	"strings"
)

// CSRF blocks cross-site state-changing requests. Pure Mania
// exposes an unauthenticated API by design, so a malicious website can otherwise
// drive a victim's browser into performing file operations (delete, move, save,
// extract) against a reachable instance using "simple" cross-origin requests
// that never trigger a CORS preflight (e.g. Content-Type: text/plain).
//
// Two independent signals are enforced:
//
//   - Sec-Fetch-Site is sent by every modern browser and is set to "cross-site"
//     for cross-origin requests. Non-browser clients (curl, scripts) omit the
//     header and remain allowed.
//   - JSON-body endpoints additionally require an application/json content type,
//     closing the gap for the remaining content types that qualify as "simple
//     requests" in older browsers.
func CSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isStateChangingMethod(r.Method) {
			if strings.EqualFold(r.Header.Get("Sec-Fetch-Site"), "cross-site") {
				http.Error(w, "Cross-site requests are not allowed", http.StatusForbidden)
				return
			}
			if !strings.HasPrefix(r.URL.Path, "/api/") {
				next.ServeHTTP(w, r)
				return
			}
			// Streaming endpoints carry non-JSON bodies (multipart form data and
			// binary upload chunks) and are not CSRF targets carrying JSON. DELETE
			// requests are bodyless and only protected by the Sec-Fetch-Site check.
			if r.Method != http.MethodPost && r.Method != http.MethodPut {
				next.ServeHTTP(w, r)
				return
			}
			if r.URL.Path == "/api/files/upload" || strings.HasSuffix(r.URL.Path, "/chunks") {
				next.ServeHTTP(w, r)
				return
			}
			if !hasJSONContentType(r) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnsupportedMediaType)
				_ = json.NewEncoder(w).Encode(map[string]interface{}{
					"success": false,
					"message": "Content-Type must be application/json",
				})
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func isStateChangingMethod(method string) bool {
	return method == http.MethodPost || method == http.MethodPut || method == http.MethodDelete
}

func hasJSONContentType(r *http.Request) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil {
		return false
	}
	mediaType = strings.ToLower(mediaType)
	return mediaType == "application/json" || strings.HasSuffix(mediaType, "+json")
}
