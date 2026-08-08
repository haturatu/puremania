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
