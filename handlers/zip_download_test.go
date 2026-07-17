package handlers

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"puremania/types"
)

func TestDownloadPreparedZipServesStoredArchive(t *testing.T) {
	h := NewHandler(&types.Config{StorageDir: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	path := t.TempDir() + "/prepared.zip"
	want := []byte("prepared archive")
	if err := os.WriteFile(path, want, 0600); err != nil {
		t.Fatal(err)
	}
	h.zipDownloads.Store("token", preparedZip{path: path, expiresAt: time.Now().Add(time.Minute)})

	req := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/api/files/download-zip/token", nil), map[string]string{"token": "token"})
	res := httptest.NewRecorder()
	h.DownloadPreparedZip(res, req)
	if res.Code != http.StatusOK || res.Body.String() != string(want) {
		t.Fatalf("status=%d body=%q", res.Code, res.Body.String())
	}
	if got := res.Header().Get("Content-Disposition"); got != "attachment; filename=\"files.zip\"" {
		t.Fatalf("Content-Disposition = %q", got)
	}
}

func TestDownloadPreparedZipRejectsExpiredToken(t *testing.T) {
	h := NewHandler(&types.Config{StorageDir: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	path := t.TempDir() + "/expired.zip"
	if err := os.WriteFile(path, []byte("expired"), 0600); err != nil {
		t.Fatal(err)
	}
	h.zipDownloads.Store("expired", preparedZip{path: path, expiresAt: time.Now().Add(-time.Second)})

	req := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/api/files/download-zip/expired", nil), map[string]string{"token": "expired"})
	res := httptest.NewRecorder()
	h.DownloadPreparedZip(res, req)
	if res.Code != http.StatusGone {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusGone)
	}
}
