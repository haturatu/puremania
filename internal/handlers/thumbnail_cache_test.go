package handlers

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCleanupThumbnailCacheRemovesOldestEntries(t *testing.T) {
	dir := t.TempDir()
	oldest := filepath.Join(dir, "oldest.jpg")
	middle := filepath.Join(dir, "middle.jpg")
	newest := filepath.Join(dir, "newest.jpg")
	for _, file := range []string{oldest, middle, newest} {
		if err := os.WriteFile(file, []byte("123456"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	if err := os.Chtimes(oldest, now.Add(-3*time.Hour), now.Add(-3*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(middle, now.Add(-2*time.Hour), now.Add(-2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(newest, now.Add(-time.Hour), now.Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}

	if err := cleanupThumbnailCache(dir, 12, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(oldest); !os.IsNotExist(err) {
		t.Fatalf("oldest thumbnail still exists, stat error=%v", err)
	}
	for _, file := range []string{middle, newest} {
		if _, err := os.Stat(file); err != nil {
			t.Fatalf("expected thumbnail %s to remain: %v", file, err)
		}
	}
}

func TestCleanupThumbnailCacheRemovesStaleTemporaryFiles(t *testing.T) {
	dir := t.TempDir()
	temp := filepath.Join(dir, ".thumbnail-stale.jpg")
	if err := os.WriteFile(temp, []byte("temporary"), 0600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-thumbnailTempTTL - time.Minute)
	if err := os.Chtimes(temp, old, old); err != nil {
		t.Fatal(err)
	}

	if err := cleanupThumbnailCache(dir, 1, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(temp); !os.IsNotExist(err) {
		t.Fatalf("stale temporary thumbnail still exists, stat error=%v", err)
	}
}
