package handlers

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"puremania/types"
)

func TestListFilesReturnsStablePages(t *testing.T) {
	storage := t.TempDir()
	for _, name := range []string{"c.txt", "a.txt", "b.txt"} {
		if err := os.WriteFile(filepath.Join(storage, name), []byte(name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	h := NewHandler(&types.Config{StorageDir: storage}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	requestPage := func(cursor string) struct {
		Success bool          `json:"success"`
		Data    directoryPage `json:"data"`
	} {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/files?path=/&limit=2&cursor="+cursor+"&sort=name&direction=asc", nil)
		res := httptest.NewRecorder()
		h.ListFiles(res, req)
		if res.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", res.Code, res.Body.String())
		}
		var response struct {
			Success bool          `json:"success"`
			Data    directoryPage `json:"data"`
		}
		if err := json.Unmarshal(res.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return response
	}

	first := requestPage("")
	if !first.Data.HasMore || first.Data.NextCursor != "2" || len(first.Data.Data) != 2 || first.Data.Data[0].Name != "a.txt" {
		t.Fatalf("unexpected first page: %#v", first.Data)
	}
	second := requestPage(first.Data.NextCursor)
	if second.Data.HasMore || len(second.Data.Data) != 1 || second.Data.Data[0].Name != "c.txt" {
		t.Fatalf("unexpected second page: %#v", second.Data)
	}
}
