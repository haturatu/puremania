package cache

import (
	"container/list"
	"puremania/types"
	"strings"
	"time"
)

// NewTTLCache は新しいTTLCacheを生成
func NewTTLCache(maxSize int64, maxItems int) *types.TTLCache {
	cache := &types.TTLCache{
		Entries:  make(map[string]*types.CacheEntry),
		Order:    list.New(),
		Nodes:    make(map[string]*list.Element),
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

// Get はキーに対応するデータを取得
func Get(c *types.TTLCache, key string) (interface{}, bool) {
	c.Mu.RLock()
	entry, exists := c.Entries[key]
	c.Mu.RUnlock()

	if !exists || entry.IsExpired() {
		if exists {
			c.Mu.Lock()
			if c.Entries[key] == entry && entry.IsExpired() {
				evict(c, key)
			}
			c.Mu.Unlock()
		}
		return nil, false
	}

	c.Mu.Lock()
	moveToFront(c, key)
	c.Mu.Unlock()

	return entry.Data, true
}

// Set はキーにデータを設定
func Set(c *types.TTLCache, key string, data interface{}, size int64, ttl time.Duration) {
	c.Mu.Lock()
	defer c.Mu.Unlock()

	// Entries larger than the cache cannot satisfy the cache's size
	// invariant. Negative sizes would corrupt the accounting in the other
	// direction, so reject both cases before evicting an existing value.
	if size < 0 || size > c.MaxSize {
		return
	}

	if _, exists := c.Entries[key]; exists {
		evict(c, key)
	}

	for c.CurSize+size > c.MaxSize || len(c.Entries) >= c.MaxItems {
		if c.Order.Len() == 0 {
			break
		}
		oldest := c.Order.Back().Value.(string)
		evict(c, oldest)
	}

	c.Entries[key] = &types.CacheEntry{
		Data:      data,
		Timestamp: time.Now(),
		Size:      size,
		TTL:       ttl,
	}
	c.Nodes[key] = c.Order.PushFront(key)
	c.CurSize += size
}

func moveToFront(c *types.TTLCache, key string) {
	if node := c.Nodes[key]; node != nil {
		c.Order.MoveToFront(node)
	}
}

func removeFromOrder(c *types.TTLCache, key string) {
	if node := c.Nodes[key]; node != nil {
		c.Order.Remove(node)
		delete(c.Nodes, key)
	}
}

func evict(c *types.TTLCache, key string) {
	if entry, exists := c.Entries[key]; exists {
		c.CurSize -= entry.Size
		delete(c.Entries, key)
		removeFromOrder(c, key)
	}
}

// InvalidateByPrefix は指定されたプレフィックスを持つキャッシュを無効化
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

// Stats はキャッシュの統計情報を返す
func Stats(c *types.TTLCache) (entries int, size int64) {
	c.Mu.RLock()
	defer c.Mu.RUnlock()
	return len(c.Entries), c.CurSize
}
