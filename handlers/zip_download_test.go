package handlers

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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
	if _, ok := h.zipDownloads.Load("token"); ok {
		t.Fatal("prepared ZIP token was not consumed")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("prepared ZIP was not removed, stat error = %v", err)
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
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expired ZIP was not removed, stat error = %v", err)
	}
}

func TestDownloadPreparedZipIsSingleUse(t *testing.T) {
	h := NewHandler(&types.Config{StorageDir: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	path := t.TempDir() + "/prepared.zip"
	if err := os.WriteFile(path, []byte("prepared archive"), 0600); err != nil {
		t.Fatal(err)
	}
	h.zipDownloads.Store("once", preparedZip{path: path, expiresAt: time.Now().Add(time.Minute)})

	first := httptest.NewRecorder()
	firstReq := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/api/files/download-zip/once", nil), map[string]string{"token": "once"})
	h.DownloadPreparedZip(first, firstReq)
	if first.Code != http.StatusOK {
		t.Fatalf("first status = %d, want %d", first.Code, http.StatusOK)
	}

	second := httptest.NewRecorder()
	secondReq := mux.SetURLVars(httptest.NewRequest(http.MethodGet, "/api/files/download-zip/once", nil), map[string]string{"token": "once"})
	h.DownloadPreparedZip(second, secondReq)
	if second.Code != http.StatusNotFound {
		t.Fatalf("second status = %d, want %d", second.Code, http.StatusNotFound)
	}
}

func TestCreateZipArchiveHonorsCanceledContext(t *testing.T) {
	h := NewHandler(&types.Config{StorageDir: t.TempDir(), MaxZipSize: 1}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	path := filepath.Join(h.config.StorageDir, "file.txt")
	if err := os.WriteFile(path, []byte("content"), 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := h.createZipArchive(ctx, io.Discard, []string{"/file.txt"}); err != context.Canceled {
		t.Fatalf("error = %v, want %v", err, context.Canceled)
	}
}
