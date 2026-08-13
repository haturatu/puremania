package health

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"time"
)

// Run executes the container healthcheck against the configured local port.
func Run() int {
	port := 8844
	if value, ok := os.LookupEnv("PORT"); ok {
		if parsed, err := strconv.Atoi(value); err == nil {
			port = parsed
		}
	}
	return runHealthcheckURL(fmt.Sprintf("http://127.0.0.1:%d/api/health", port), os.Stderr)
}

func runHealthcheckURL(url string, stderr io.Writer) int {
	client := &http.Client{Timeout: 4 * time.Second, Transport: &http.Transport{DisableKeepAlives: true, DialContext: (&net.Dialer{Timeout: 2 * time.Second, KeepAlive: -1}).DialContext}}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, err)
		return 1
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "puremania-healthcheck")
	response, err := client.Do(req)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, err)
		return 1
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		_, _ = fmt.Fprintf(stderr, "unexpected HTTP status: %s\n", response.Status)
		return 1
	}
	var health struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<10)).Decode(&health); err != nil {
		_, _ = fmt.Fprintf(stderr, "invalid health response: %v\n", err)
		return 1
	}
	if health.Status != "ok" {
		_, _ = fmt.Fprintf(stderr, "unhealthy status: %q\n", health.Status)
		return 1
	}
	return 0
}
