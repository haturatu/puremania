package handlers

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"puremania/internal/types"
)

func TestDirectoryStateKeyPreservesEncodingAndDetectsChanges(t *testing.T) {
	storage := t.TempDir()
	mounts := []string{t.TempDir(), t.TempDir()}
	h := &Handler{config: &types.Config{StorageDir: storage, MountDirs: mounts}, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	file := filepath.Join(storage, "日本語:;"+strings.Repeat("x", 220))
	if err := os.WriteFile(file, []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(storage, "directory"), 0700); err != nil {
		t.Fatal(err)
	}
	check := func() string {
		t.Helper()
		got, err := h.generateDirectoryStateKey("/")
		if err != nil {
			t.Fatal(err)
		}
		// Reference the previous wire encoding, including mount metadata.
		hash := md5.New()
		entries, err := os.ReadDir(storage)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			info, err := entry.Info()
			if err != nil {
				t.Fatal(err)
			}
			_, _ = fmt.Fprintf(hash, "%s:%d:%d;", info.Name(), info.Size(), info.ModTime().UnixNano())
		}
		for _, mount := range slices.Sorted(slices.Values(mounts)) {
			info, err := os.Stat(mount)
			if err != nil {
				t.Fatal(err)
			}
			_, _ = fmt.Fprintf(hash, "mount_%s:%d:%d;", info.Name(), info.Size(), info.ModTime().UnixNano())
		}
		if want := hex.EncodeToString(hash.Sum(nil)); got != want {
			t.Fatalf("state key = %q, want previous encoding %q", got, want)
		}
		return got
	}
	before := check()
	if again := check(); again != before {
		t.Fatal("unchanged directory produced a different state key")
	}
	mtime := time.Unix(123, 456)
	if err := os.Chtimes(file, mtime, mtime); err != nil {
		t.Fatal(err)
	}
	if after := check(); after == before {
		t.Fatal("metadata change did not invalidate the state key")
	}
	before = check()
	if err := os.WriteFile(file, []byte("new size"), 0600); err != nil {
		t.Fatal(err)
	}
	if after := check(); after == before {
		t.Fatal("size change did not invalidate the state key")
	}
}
