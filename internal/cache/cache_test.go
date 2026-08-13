package cache

import (
	"testing"
	"time"
)

func TestSetReplacementKeepsSizeAccounting(t *testing.T) {
	c := NewTTLCache(10, 10)

	Set(c, "key", "first", 6, time.Hour)
	Set(c, "key", "second", 6, time.Hour)

	entries, size := Stats(c)
	if entries != 1 || size != 6 {
		t.Fatalf("after replacement: entries=%d size=%d, want entries=1 size=6", entries, size)
	}

	Set(c, "other", "third", 5, time.Hour)

	entries, size = Stats(c)
	if entries != 1 || size != 5 {
		t.Fatalf("after size-based eviction: entries=%d size=%d, want entries=1 size=5", entries, size)
	}
	if _, ok := Get(c, "key"); ok {
		t.Fatal("expected the replaced key to be evicted when the cache limit is exceeded")
	}
}

func TestSetRejectsInvalidSizes(t *testing.T) {
	c := NewTTLCache(10, 10)

	Set(c, "valid", "value", 4, time.Hour)
	Set(c, "oversized", "value", 11, time.Hour)
	Set(c, "negative", "value", -1, time.Hour)

	entries, size := Stats(c)
	if entries != 1 || size != 4 {
		t.Fatalf("expected one 4-byte entry, got entries=%d size=%d", entries, size)
	}
	if _, ok := Get(c, "valid"); !ok {
		t.Fatal("expected valid entry to remain cached")
	}
}

func TestSetRejectsInvalidReplacementWithoutRemovingExistingEntry(t *testing.T) {
	c := NewTTLCache(10, 10)

	Set(c, "key", "original", 6, time.Hour)
	Set(c, "key", "oversized replacement", 11, time.Hour)

	entry, ok := Get(c, "key")
	if !ok {
		t.Fatal("expected original entry to remain cached")
	}
	if entry != "original" {
		t.Fatalf("expected original value, got %v", entry)
	}
	_, size := Stats(c)
	if size != 6 {
		t.Fatalf("expected size accounting to remain 6, got %d", size)
	}
}
