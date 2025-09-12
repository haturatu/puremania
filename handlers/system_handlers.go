package handlers

import (
	"net/http"
	"os"
	"path/filepath"
	"syscall"
	"time"
)

// SpecificDirInfo は、フロントエンドに渡すための特定のディレクトリ情報です。
type SpecificDirInfo struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// GetConfig - クライアントに渡す設定情報
func (h *Handler) GetConfig(w http.ResponseWriter, r *http.Request) {
	clientConfig := struct {
		StorageDir   string   `json:"StorageDir"`
		MountDirs    []string `json:"MountDirs"`
		MaxFileSize  int64    `json:"MaxFileSize"`
		SpecificDirs []string `json:"SpecificDirs"`
	}{
		StorageDir:   h.config.GetStorageDir(),
		MountDirs:    h.config.GetMountDirs(),
		MaxFileSize:  h.config.GetMaxFileSize(),
		SpecificDirs: h.config.GetSpecificDirs(),
	}
	h.respondSuccess(w, clientConfig)
}

func (h *Handler) GetStorageInfo(w http.ResponseWriter, r *http.Request) {
	// キャッシュチェック
	cacheKey := "storage_info"
	if cached, found := h.cache.Get(cacheKey); found {
		if storageInfo, ok := cached.(map[string]interface{}); ok {
			h.respondSuccess(w, storageInfo)
			return
		}
	}

	// 並列処理でストレージ情報取得
	resultChan := h.workerPool.SubmitWithResult(func() interface{} {
		var stat syscall.Statfs_t

		err := syscall.Statfs(h.config.GetStorageDir(), &stat)
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
		h.cache.Set(cacheKey, storageInfo, 1024, CacheTTL)
		h.respondSuccess(w, storageInfo)
	} else {
		h.respondError(w, "Cannot get storage info", http.StatusInternalServerError)
	}
}

// ヘルスチェック用エンドポイント
func (h *Handler) HealthCheck(w http.ResponseWriter, r *http.Request) {
	cacheEntries, cacheSize := h.cache.Stats()
	status := map[string]interface{}{
		"status":         "healthy",
		"timestamp":      time.Now().Format(time.RFC3339),
		"active_workers": h.workerPool.ActiveWorkers(),
		"cache_stats": map[string]interface{}{
			"entries": cacheEntries,
			"size":    cacheSize,
		},
	}

	h.respondSuccess(w, status)
}

// GetSpecificDirs は、設定された特定のディレクトリのリストを返します。
func (h *Handler) GetSpecificDirs(w http.ResponseWriter, r *http.Request) {
	dirs := h.config.GetSpecificDirs()
	dirInfos := make([]SpecificDirInfo, 0, len(dirs))

	for _, dirPath := range dirs {
		// フォルダが存在するかどうかを確認
		if info, err := os.Stat(dirPath); err == nil && info.IsDir() {
			dirInfos = append(dirInfos, SpecificDirInfo{
				Name: filepath.Base(dirPath),
				Path: "/" + filepath.Base(dirPath), // フロントには仮想パスを渡す
			})
		}
	}

	h.respondSuccess(w, dirInfos)
}
