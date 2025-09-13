package types

import (
	"sync"
	"time"
)

// CacheEntry は統一キャッシュエントリ（TTL付き）です。
type CacheEntry struct {
	Data      interface{}
	Timestamp time.Time
	Size      int64
	TTL       time.Duration
}

// IsExpired はエントリが期限切れかどうかを返します。
func (c *CacheEntry) IsExpired() bool {
	return time.Since(c.Timestamp) > c.TTL
}

// TTLCache は統一TTLキャッシュです。
type TTLCache struct {
	Mu       sync.RWMutex
	Entries  map[string]*CacheEntry
	Order    []string
	MaxSize  int64
	MaxItems int
	CurSize  int64
}