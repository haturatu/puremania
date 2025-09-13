package cache

import (
	"puremania/types"
	"strings"
	"time"
)

// NewTTLCache は新しいTTLCacheを生成します。
func NewTTLCache(maxSize int64, maxItems int) *types.TTLCache {
	cache := &types.TTLCache{
		Entries:  make(map[string]*types.CacheEntry),
		Order:    make([]string, 0, maxItems),
		MaxSize:  maxSize,
		MaxItems: maxItems,
	}

	go cleanupExpired(cache)

	return cache
}

func cleanupExpired(c *types.TTLCache) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		c.Mu.Lock()
		var toDelete []string

		for key, entry := range c.Entries {
			if entry.IsExpired() {
				toDelete = append(toDelete, key)
			}
		}

		for _, key := range toDelete {
			evict(c, key)
		}
		c.Mu.Unlock()
	}
}

// Get はキーに対応するデータを取得します。
func Get(c *types.TTLCache, key string) (interface{}, bool) {
	c.Mu.RLock()
	entry, exists := c.Entries[key]
	c.Mu.RUnlock()

	if !exists || entry.IsExpired() {
		if exists {
			c.Mu.Lock()
			evict(c, key)
			c.Mu.Unlock()
		}
		return nil, false
	}

	c.Mu.Lock()
	moveToFront(c, key)
	c.Mu.Unlock()

	return entry.Data, true
}

// Set はキーにデータを設定します。
func Set(c *types.TTLCache, key string, data interface{}, size int64, ttl time.Duration) {
	c.Mu.Lock()
	defer c.Mu.Unlock()

	if existing, exists := c.Entries[key]; exists {
		c.CurSize -= existing.Size
		removeFromOrder(c, key)
	}

	for c.CurSize+size > c.MaxSize || len(c.Entries) >= c.MaxItems {
		if len(c.Order) == 0 {
			break
		}
		oldest := c.Order[len(c.Order)-1]
		evict(c, oldest)
	}

	c.Entries[key] = &types.CacheEntry{
		Data:      data,
		Timestamp: time.Now(),
		Size:      size,
		TTL:       ttl,
	}
	c.Order = append([]string{key}, c.Order...)
	c.CurSize += size
}

func moveToFront(c *types.TTLCache, key string) {
	for i, k := range c.Order {
		if k == key {
			c.Order = append([]string{key}, append(c.Order[:i], c.Order[i+1:]...)...)
			break
		}
	}
}

func removeFromOrder(c *types.TTLCache, key string) {
	for i, k := range c.Order {
		if k == key {
			c.Order = append(c.Order[:i], c.Order[i+1:]...)
			break
		}
	}
}

func evict(c *types.TTLCache, key string) {
	if entry, exists := c.Entries[key]; exists {
		c.CurSize -= entry.Size
		delete(c.Entries, key)
		removeFromOrder(c, key)
	}
}

// InvalidateByPrefix は指定されたプレフィックスを持つキャッシュを無効化します。
func InvalidateByPrefix(c *types.TTLCache, prefix string) {
	c.Mu.Lock()
	defer c.Mu.Unlock()

	var toDelete []string
	for key := range c.Entries {
		if strings.HasPrefix(key, prefix) {
			toDelete = append(toDelete, key)
		}
	}

	for _, key := range toDelete {
			evict(c, key)
		}
}

// Stats はキャッシュの統計情報を返します。
func Stats(c *types.TTLCache) (entries int, size int64) {
	c.Mu.RLock()
	defer c.Mu.RUnlock()
	return len(c.Entries), c.CurSize
}
