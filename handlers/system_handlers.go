package handlers

import (
	"net/http"
	"os"
	"path/filepath"
	"puremania/cache"
	"puremania/types"
	"puremania/worker"
	"syscall"
	"time"
)

// GetConfig - クライアントに渡す設定情報
func (h *Handler) GetConfig(w http.ResponseWriter, r *http.Request) {
	clientConfig := struct {
		StorageDir   string   `json:"StorageDir"`
		MountDirs    []string `json:"MountDirs"`
		MaxFileSize  int64    `json:"MaxFileSize"`
		SpecificDirs []string `json:"SpecificDirs"`
	}{
		StorageDir:   h.config.StorageDir,
		MountDirs:    h.config.MountDirs,
		MaxFileSize:  h.config.MaxFileSize,
		SpecificDirs: h.config.SpecificDirs,
	}
	h.respondSuccess(w, clientConfig)
}

func (h *Handler) GetStorageInfo(w http.ResponseWriter, r *http.Request) {
	// キャッシュチェック
	cacheKey := "storage_info"
	if cached, found := cache.Get(h.cache, cacheKey); found {
		if storageInfo, ok := cached.(map[string]interface{}); ok {
			h.respondSuccess(w, storageInfo)
			return
		}
	}

	// 並列処理でストレージ情報取得
	resultChan := worker.SubmitWithResult(h.workerPool, func() interface{} {
		var stat syscall.Statfs_t

		err := syscall.Statfs(h.config.StorageDir, &stat)
		if err != nil {
			return nil
		}

		total := stat.Blocks * uint64(stat.Bsize)
		free := stat.Bfree * uint64(stat.Bsize)
		used := total - free

		return map[string]interface{}{
			"total":         total,
			"free":          free,
			"used":          used,
			"usage_percent": float64(used) / float64(total) * 100,
		}
	})

	result := <-resultChan
	if storageInfo, ok := result.(map[string]interface{}); ok {
		// 5分間キャッシュ
		cache.Set(h.cache, cacheKey, storageInfo, 1024, CacheTTL)
		h.respondSuccess(w, storageInfo)
	} else {
		h.respondError(w, "Cannot get storage info", http.StatusInternalServerError)
	}
}

// ヘルスチェック用エンドポイント
func (h *Handler) HealthCheck(w http.ResponseWriter, r *http.Request) {
	cacheEntries, cacheSize := cache.Stats(h.cache)
	status := map[string]interface{}{
		"status":         "healthy",
		"timestamp":      time.Now().Format(time.RFC3339),
		"active_workers": worker.ActiveWorkers(h.workerPool),
		"cache_stats": map[string]interface{}{
			"entries": cacheEntries,
			"size":    cacheSize,
		},
	}

	h.respondSuccess(w, status)
}

// GetSpecificDirs は、設定された特定のディレクトリのリストを返す
func (h *Handler) GetSpecificDirs(w http.ResponseWriter, r *http.Request) {
	dirs := h.config.SpecificDirs
	dirInfos := make([]types.SpecificDirInfo, 0, len(dirs))

	for _, dirPath := range dirs {
		// フォルダが存在するかどうかを確認
		if info, err := os.Stat(dirPath); err == nil && info.IsDir() {
			dirInfos = append(dirInfos, types.SpecificDirInfo{
				Name: filepath.Base(dirPath),
				Path: "/" + filepath.Base(dirPath), // フロントには仮想パスを渡す
			})
		}
	}

	h.respondSuccess(w, dirInfos)
}
