package handlers

import (
	"hash/fnv"
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
	config               *types.Config
	cache                *types.TTLCache
	workerPool           *types.WorkerPool
	logger               *slog.Logger
	uploadLocks          [256]sync.Mutex // fixed striped locks; serializes writes to one session without unbounded state
	uploadGate           chan struct{}   // bounds concurrent disk writes across sessions
	zipGate              chan struct{}   // bounds concurrent archive preparation
	extractGate          chan struct{}   // bounds concurrent archive extraction
	thumbnailGate        chan struct{}   // bounds concurrent ffmpeg work
	searchGate           chan struct{}   // bounds concurrent recursive searches
	zipDownloads         sync.Map        // token -> preparedZip; entries expire after download preparation
	thumbnailCleanupMu   sync.Mutex
	lastThumbnailCleanup time.Time
}

type preparedZip struct {
	path      string
	expiresAt time.Time
}

func (h *Handler) sessionMutex(id string) *sync.Mutex {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(id))
	return &h.uploadLocks[hash.Sum32()%uint32(len(h.uploadLocks))]
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
		config:        config,
		cache:         cache.NewTTLCache(250*1024*1024, 15000), // 250MB, 15K items
		workerPool:    worker.NewWorkerPool(),
		logger:        logger,
		uploadGate:    make(chan struct{}, writeSlots),
		zipGate:       make(chan struct{}, 2),
		extractGate:   make(chan struct{}, 2),
		thumbnailGate: make(chan struct{}, 2),
		searchGate:    make(chan struct{}, 4),
	}
	h.cleanupExpiredUploadSessions()
	return h
}
