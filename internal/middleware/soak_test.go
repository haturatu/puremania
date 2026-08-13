package middleware

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"
)

func TestHTTPSoak(t *testing.T) {
	duration := 2 * time.Second
	if value := os.Getenv("SOAK_DURATION"); value != "" {
		parsed, err := time.ParseDuration(value)
		if err != nil || parsed <= 0 {
			t.Fatalf("invalid SOAK_DURATION %q: %v", value, err)
		}
		duration = parsed
	}

	router := http.NewServeMux()
	router.HandleFunc("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	router.HandleFunc("/api/files/delete", func(w http.ResponseWriter, r *http.Request) {
		if _, err := io.Copy(io.Discard, r.Body); err != nil {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	server := httptest.NewServer(SecurityHeaders(RequestBodyLimit(ResponseCompression(router))))
	defer server.Close()

	client := &http.Client{Timeout: 5 * time.Second}
	deadline := time.Now().Add(duration)
	var wg sync.WaitGroup
	errors := make(chan error, 16)
	for workerID := 0; workerID < 8; workerID++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for time.Now().Before(deadline) {
				var response *http.Response
				var err error
				if id%2 == 0 {
					response, err = client.Get(server.URL + "/api/health")
				} else {
					body := bytes.Repeat([]byte("x"), maxJSONBodyBytes+1)
					response, err = client.Post(server.URL+"/api/files/delete", "application/json", bytes.NewReader(body))
				}
				if err != nil {
					errors <- err
					return
				}
				status := response.StatusCode
				_ = response.Body.Close()
				if id%2 == 0 && status != http.StatusOK {
					errors <- &soakStatusError{worker: id, status: status}
					return
				}
				if id%2 == 1 && status != http.StatusRequestEntityTooLarge {
					errors <- &soakStatusError{worker: id, status: status}
					return
				}
			}
		}(workerID)
	}
	wg.Wait()
	close(errors)
	for err := range errors {
		t.Error(err)
	}
}

type soakStatusError struct {
	worker int
	status int
}

func (e *soakStatusError) Error() string {
	return "soak worker " + strconv.Itoa(e.worker) + " received unexpected status " + strconv.Itoa(e.status)
}
