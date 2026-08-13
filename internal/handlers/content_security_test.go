package handlers

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"puremania/internal/types"
)

func newContentTestHandler(t *testing.T) *Handler {
	t.Helper()
	return NewHandler(&types.Config{StorageDir: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func writeTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

func TestDownloadSandboxesActiveContent(t *testing.T) {
	h := newContentTestHandler(t)
	writeTestFile(t, filepath.Join(h.config.StorageDir, "evil.svg"), `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)

	res := httptest.NewRecorder()
	h.DownloadFile(res, httptest.NewRequest(http.MethodGet, "/api/files/download?path=/evil.svg", nil))

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusOK)
	}
	if got := res.Header().Get("Content-Security-Policy"); got != "sandbox" {
		t.Fatalf("Content-Security-Policy = %q, want sandbox", got)
	}
	if got := res.Header().Get("Content-Type"); got != "image/svg+xml" {
		t.Fatalf("Content-Type = %q, want image/svg+xml", got)
	}
}

func TestDownloadSandboxesMediaContent(t *testing.T) {
	h := newContentTestHandler(t)
	writeTestFile(t, filepath.Join(h.config.StorageDir, "clip.mp4"), "not really a video")

	res := httptest.NewRecorder()
	h.DownloadFile(res, httptest.NewRequest(http.MethodGet, "/api/files/download?path=/clip.mp4", nil))

	if got := res.Header().Get("Content-Security-Policy"); got != "sandbox" {
		t.Fatalf("Content-Security-Policy = %q, want sandbox", got)
	}
}

func TestGetFileContentSandboxesImageContent(t *testing.T) {
	h := newContentTestHandler(t)
	writeTestFile(t, filepath.Join(h.config.StorageDir, "evil.svg"), `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`)

	res := httptest.NewRecorder()
	h.GetFileContent(res, httptest.NewRequest(http.MethodGet, "/api/files/content?path=/evil.svg", nil))

	if got := res.Header().Get("Content-Security-Policy"); got != "sandbox" {
		t.Fatalf("Content-Security-Policy = %q, want sandbox", got)
	}
}
