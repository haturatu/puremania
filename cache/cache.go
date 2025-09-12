package cache

import (
	"sync"
	"time"
	"strings"
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
	mu       sync.RWMutex
	entries  map[string]*CacheEntry
	order    []string
	maxSize  int64
	maxItems int
	curSize  int64
}

// NewTTLCache は新しいTTLCacheを生成します。
func NewTTLCache(maxSize int64, maxItems int) *TTLCache {
	cache := &TTLCache{
		entries:  make(map[string]*CacheEntry),
		order:    make([]string, 0, maxItems),
		maxSize:  maxSize,
		maxItems: maxItems,
	}

	go cache.cleanupExpired()

	return cache
}

func (c *TTLCache) cleanupExpired() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		c.mu.Lock()
		var toDelete []string

		for key, entry := range c.entries {
			if entry.IsExpired() {
				toDelete = append(toDelete, key)
			}
		}

		for _, key := range toDelete {
			c.evict(key)
		}
		c.mu.Unlock()
	}
}

// Get はキーに対応するデータを取得します。
func (c *TTLCache) Get(key string) (interface{}, bool) {
	c.mu.RLock()
	entry, exists := c.entries[key]
	c.mu.RUnlock()

	if !exists || entry.IsExpired() {
		if exists {
			c.mu.Lock()
			c.evict(key)
			c.mu.Unlock()
		}
		return nil, false
	}

	c.mu.Lock()
	c.moveToFront(key)
	c.mu.Unlock()

	return entry.Data, true
}

// Set はキーにデータを設定します。
func (c *TTLCache) Set(key string, data interface{}, size int64, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if existing, exists := c.entries[key]; exists {
		c.curSize -= existing.Size
		c.removeFromOrder(key)
	}

	for c.curSize+size > c.maxSize || len(c.entries) >= c.maxItems {
		if len(c.order) == 0 {
			break
		}
		oldest := c.order[len(c.order)-1]
		c.evict(oldest)
	}

	c.entries[key] = &CacheEntry{
		Data:      data,
		Timestamp: time.Now(),
		Size:      size,
		TTL:       ttl,
	}
	c.order = append([]string{key}, c.order...)
	c.curSize += size
}

func (c *TTLCache) moveToFront(key string) {
	for i, k := range c.order {
		if k == key {
			c.order = append([]string{key}, append(c.order[:i], c.order[i+1:]...)...)
			break
		}
	}
}

func (c *TTLCache) removeFromOrder(key string) {
	for i, k := range c.order {
		if k == key {
			c.order = append(c.order[:i], c.order[i+1:]...)
			break
		}
	}
}

func (c *TTLCache) evict(key string) {
	if entry, exists := c.entries[key]; exists {
		c.curSize -= entry.Size
		delete(c.entries, key)
		c.removeFromOrder(key)
	}
}

// InvalidateByPrefix は指定されたプレフィックスを持つキャッシュを無効化します。
func (c *TTLCache) InvalidateByPrefix(prefix string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	var toDelete []string
	for key := range c.entries {
		if strings.HasPrefix(key, prefix) {
			toDelete = append(toDelete, key)
		}
	}

	for _, key := range toDelete {
		c.evict(key)
	}
}

// Stats はキャッシュの統計情報を返します。
func (c *TTLCache) Stats() (entries int, size int64) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.entries), c.curSize
}
