package handlers

import (
	"puremania/cache"
	"puremania/worker"
	"time"
)

const (
	CacheTTL = 5 * time.Minute // Cache TTL
)

// IConfig は設定インターフェースです。
type IConfig interface {
	GetStorageDir() string
	GetMountDirs() []string
	GetMaxFileSize() int64
	GetSpecificDirs() []string
}

// Handler はAPIハンドラーの依存関係を保持します。
type Handler struct {
	config     IConfig
	cache      *cache.TTLCache
	workerPool *worker.WorkerPool
}

// NewHandler は新しいHandlerを生成します。
func NewHandler(config IConfig) *Handler {
	return &Handler{
		config:     config,
		cache:      cache.NewTTLCache(250*1024*1024, 15000), // 250MB, 15K items
		workerPool: worker.NewWorkerPool(),
	}
}