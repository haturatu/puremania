package handlers

import (
	"log/slog"
	"puremania/cache"
	"puremania/types"
	"puremania/worker"
	"runtime"
	"sync"
	"time"
)

const (
	CacheTTL = 5 * time.Minute // Cache TTL
)

// Handler はAPIハンドラーの依存関係を保持
type Handler struct {
	config      *types.Config
	cache       *types.TTLCache
	workerPool  *types.WorkerPool
	logger      *slog.Logger
	uploadLocks sync.Map      // map[upload id]*sync.Mutex; serializes writes to one session
	uploadGate  chan struct{} // bounds concurrent disk writes across sessions
}

// NewHandler は新しいHandlerを生成
func NewHandler(config *types.Config, logger *slog.Logger) *Handler {
	// Small-file 1 Gbps uploads are request-latency bound. Allow sufficient
	// overlap, while retaining a finite disk-write gate for backpressure.
	writeSlots := runtime.GOMAXPROCS(0) * 4
	if writeSlots < 8 {
		writeSlots = 8
	}
	if writeSlots > 32 {
		writeSlots = 32
	}
	h := &Handler{
		config:     config,
		cache:      cache.NewTTLCache(250*1024*1024, 15000), // 250MB, 15K items
		workerPool: worker.NewWorkerPool(),
		logger:     logger,
		uploadGate: make(chan struct{}, writeSlots),
	}
	h.cleanupExpiredUploadSessions()
	return h
}
