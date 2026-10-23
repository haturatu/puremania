package handlers

import (
	"fmt"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"puremania/internal/cache"
	"puremania/internal/types"
)

// Keep this fixture deterministic and mixed-case: lower-case-only filenames
// hide allocations made while comparing names during sorting.
func benchmarkFileList(count int) []types.FileInfo {
	files := make([]types.FileInfo, count)
	for i := range files {
		name := fmt.Sprintf("Photo-%06d.JPG", (i*7919)%count)
		files[i] = types.FileInfo{
			Name: name, Path: "/album/" + name, Size: int64(i % 1024),
			ModTime: "2026-10-01T12:00:00Z", MimeType: "image/jpeg",
		}
	}
	return files
}

func BenchmarkPaginatedFileList(b *testing.B) {
	for _, count := range []int{3000, 30000} {
		for _, field := range []string{"name", "size", "modified", "type"} {
			b.Run(fmt.Sprintf("%d/%s", count, field), func(b *testing.B) {
				h := &Handler{cache: cache.NewTTLCache(250<<20, 15000)}
				files := benchmarkFileList(count)
				cache.Set(h.cache, "list:benchmark", files, int64(len(files)*200), time.Hour)
				req := httptest.NewRequest("GET", fmt.Sprintf("/api/files?cursor=%d&sort=%s&direction=asc", count/2, field), nil)
				b.ReportAllocs()
				b.ResetTimer()
				for b.Loop() {
					h.servePaginatedFileList(httptest.NewRecorder(), req, "/album", "benchmark", 100)
				}
			})
		}
	}
}

func benchmarkDirectory(b *testing.B, count int) *Handler {
	b.Helper()
	storage := b.TempDir()
	for i := range count {
		if err := os.WriteFile(filepath.Join(storage, fmt.Sprintf("Photo-%06d.JPG", i)), nil, 0600); err != nil {
			b.Fatal(err)
		}
	}
	return &Handler{
		config: &types.Config{StorageDir: storage},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		cache:  cache.NewTTLCache(250<<20, 15000),
	}
}

func BenchmarkDirectoryStateKey(b *testing.B) {
	h := benchmarkDirectory(b, 3000)
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		if _, err := h.generateDirectoryStateKey("/"); err != nil {
			b.Fatal(err)
		}
	}
}

// Include filesystem revalidation as well as a warm cached listing, so sort
// speedups are not presented as equivalent end-to-end HTTP speedups.
func BenchmarkListFilesWarm(b *testing.B) {
	h := benchmarkDirectory(b, 3000)
	key, err := h.generateDirectoryStateKey("/")
	if err != nil {
		b.Fatal(err)
	}
	cache.Set(h.cache, "list:"+key, benchmarkFileList(3000), 3000*200, time.Hour)
	req := httptest.NewRequest("GET", "/api/files?path=/&limit=100&sort=name", nil)
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		h.ListFiles(httptest.NewRecorder(), req)
	}
}
