package handlers

import (
	"io"
	"log/slog"
	"testing"
	"time"

	"puremania/types"
)

func TestStorePreparedZipCapsUnconsumedArchives(t *testing.T) {
	h := NewHandler(&types.Config{StorageDir: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	expiresAt := time.Now().Add(time.Hour)
	for i := 0; i < maxPreparedZips; i++ {
		if !h.storePreparedZip(string(rune('a'+i)), preparedZip{expiresAt: expiresAt}) {
			t.Fatalf("archive %d was rejected before the configured cap", i)
		}
	}
	if h.storePreparedZip("overflow", preparedZip{expiresAt: expiresAt}) {
		t.Fatal("expected an unconsumed archive over the cap to be rejected")
	}

	for i := 0; i < maxPreparedZips; i++ {
		h.expirePreparedZip(string(rune('a' + i)))
	}
}

func TestStorePreparedZipSweepsExpiredArchives(t *testing.T) {
	h := NewHandler(&types.Config{StorageDir: t.TempDir()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	h.zipDownloads.Store("expired", preparedZip{expiresAt: time.Now().Add(-time.Second)})
	if !h.storePreparedZip("fresh", preparedZip{expiresAt: time.Now().Add(time.Hour)}) {
		t.Fatal("expected expired archive to be swept before applying the cap")
	}
	if _, ok := h.zipDownloads.Load("expired"); ok {
		t.Fatal("expired archive remained in the download map")
	}
	h.expirePreparedZip("fresh")
}
