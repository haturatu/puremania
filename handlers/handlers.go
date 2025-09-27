package handlers

import (
	"log/slog"
	"puremania/cache"
	"puremania/types"
	"puremania/worker"
	"time"
)

const (
	CacheTTL = 5 * time.Minute // Cache TTL
)

// Handler はAPIハンドラーの依存関係を保持
type Handler struct {
	config     *types.Config
	cache      *types.TTLCache
	workerPool *types.WorkerPool
	logger     *slog.Logger
}

// NewHandler は新しいHandlerを生成
func NewHandler(config *types.Config, logger *slog.Logger) *Handler {
	return &Handler{
		config:     config,
		cache:      cache.NewTTLCache(250*1024*1024, 15000), // 250MB, 15K items
		workerPool: worker.NewWorkerPool(),
		logger:     logger,
	}
}
