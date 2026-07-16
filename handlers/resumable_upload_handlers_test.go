package handlers

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"puremania/types"
	"strings"
	"testing"
)

func newUploadTestHandler(t *testing.T) *Handler {
	t.Helper()
	return NewHandler(&types.Config{StorageDir: t.TempDir(), MaxFileSize: 1}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func createTestUpload(t *testing.T, h *Handler, relativePath string, size int64) (string, string) {
	t.Helper()
	body := strings.NewReader(`{"path":"/","relativePath":"` + relativePath + `","size":` + string(rune('0'+size)) + `,"fingerprint":"` + strings.Repeat("a", 64) + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/files/upload-sessions", body)
	res := httptest.NewRecorder()
	h.CreateUpload(res, req)
	if res.Code != http.StatusCreated {
		t.Fatalf("create status = %d, body = %s", res.Code, res.Body.String())
	}
	var created struct{ UploadID, UploadURL string }
	if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	return created.UploadID, created.UploadURL
}

func TestUploadChunkOversizeRetryCannotLeaveTail(t *testing.T) {
	h := newUploadTestHandler(t)
	_, url := createTestUpload(t, h, "result.bin", 3)

	oversize := httptest.NewRequest(http.MethodPut, url+"/chunks", bytes.NewReader([]byte("abcd")))
	// Simulate chunked transfer: the server cannot reject the request based on
	// Content-Length and must inspect the byte after the declared range.
	oversize.ContentLength = -1
	oversize.Header.Set("Content-Range", "bytes 0-2/3")
	bad := httptest.NewRecorder()
	h.UploadChunk(bad, oversize)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("oversize status = %d", bad.Code)
	}

	retry := httptest.NewRequest(http.MethodPut, url+"/chunks", bytes.NewReader([]byte("abc")))
	retry.Header.Set("Content-Range", "bytes 0-2/3")
	ok := httptest.NewRecorder()
	h.UploadChunk(ok, retry)
	if ok.Code != http.StatusOK {
		t.Fatalf("retry status = %d, body = %s", ok.Code, ok.Body.String())
	}

	complete := httptest.NewRecorder()
	h.CompleteUpload(complete, httptest.NewRequest(http.MethodPost, url+"/complete", nil))
	if complete.Code != http.StatusOK {
		t.Fatalf("complete status = %d, body = %s", complete.Code, complete.Body.String())
	}
	content, err := os.ReadFile(filepath.Join(h.config.StorageDir, "result.bin"))
	if err != nil {
		t.Fatal(err)
	}
	if got := string(content); got != "abc" {
		t.Fatalf("completed content = %q, want %q", got, "abc")
	}
}

func TestCompleteUploadRecoversAfterRenameBeforeMetadata(t *testing.T) {
	h := newUploadTestHandler(t)
	id, url := createTestUpload(t, h, "recovered.bin", 3)
	session, err := h.readUploadSession(id)
	if err != nil {
		t.Fatal(err)
	}
	session.UploadedBytes = 3
	if err := h.writeUploadSession(session); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(h.config.StorageDir, "recovered.bin"), []byte("abc"), 0600); err != nil {
		t.Fatal(err)
	}

	res := httptest.NewRecorder()
	h.CompleteUpload(res, httptest.NewRequest(http.MethodPost, url+"/complete", nil))
	if res.Code != http.StatusOK {
		t.Fatalf("recovery status = %d, body = %s", res.Code, res.Body.String())
	}
	recovered, err := h.readUploadSession(id)
	if err != nil {
		t.Fatal(err)
	}
	if !recovered.Completed {
		t.Fatal("session was not repaired as completed")
	}
}
