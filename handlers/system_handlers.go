package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
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
		StorageDir    string   `json:"StorageDir"`
		MountDirs     []string `json:"MountDirs"`
		MaxFileSize   int64    `json:"MaxFileSize"`
		SpecificDirs  []string `json:"SpecificDirs"`
		Aria2cEnabled bool     `json:"Aria2cEnabled"`
	}{
		StorageDir:    h.config.StorageDir,
		MountDirs:     h.config.MountDirs,
		MaxFileSize:   h.config.MaxFileSize,
		SpecificDirs:  h.config.SpecificDirs,
		Aria2cEnabled: h.config.Aria2cEnabled,
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
			h.logger.Error("Failed to get storage stats", "path", h.config.StorageDir, "error", err)
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
	if storageInfo, ok := result.(map[string]interface{}); ok && storageInfo != nil {
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
		} else if err != nil {
			h.logger.Warn("Specific directory not found or not a directory", "path", dirPath, "error", err)
		}
	}

	h.respondSuccess(w, dirInfos)
}

// callAria2cRPC はAria2cのJSON-RPCを呼び出すヘルパー関数
func (h *Handler) callAria2cRPC(method string, params ...interface{}) (interface{}, error) {
	if h.config.Aria2cRPCURL == "" {
		return nil, fmt.Errorf("Aria2c RPC URL is not configured")
	}

	// トークンをパラメータの先頭に追加
	rpcParams := []interface{}{}
	if h.config.Aria2cRPCToken != "" {
		rpcParams = append(rpcParams, "token:"+h.config.Aria2cRPCToken)
	}
	rpcParams = append(rpcParams, params...)

	reqBody := types.Aria2cRPCRequest{
		Jsonrpc: "2.0",
		ID:      "puremania",
		Method:  method,
		Params:  rpcParams,
	}

	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal aria2c request: %w", err)
	}

	resp, err := http.Post(h.config.Aria2cRPCURL, "application/json", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to aria2c RPC: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read aria2c response body: %w", err)
	}

	var rpcResp types.Aria2cRPCResponse
	if err := json.Unmarshal(body, &rpcResp); err != nil {
		return nil, fmt.Errorf("failed to parse aria2c RPC response: %w. Body: %s", err, string(body))
	}

	if rpcResp.Error != nil {
		return nil, fmt.Errorf("aria2c RPC error: %s (code: %d)", rpcResp.Error.Message, rpcResp.Error.Code)
	}

	return rpcResp.Result, nil
}

// DownloadWithAria2c はaria2cを使ってファイルをダウンロード
func (h *Handler) DownloadWithAria2c(w http.ResponseWriter, r *http.Request) {
	var req types.Aria2cDownloadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.logger.Error("Failed to decode aria2c download request", "error", err)
		h.respondError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.URL == "" || req.Path == "" {
		h.respondError(w, "URL and path are required", http.StatusBadRequest)
		return
	}

	safePath, err := h.buildSafePath(req.Path)
	if err != nil {
		h.logger.Error("Invalid path for aria2c download", "path", req.Path, "error", err)
		h.respondError(w, err.Error(), http.StatusBadRequest)
		return
	}

	// aria2.addUriを呼び出す
	params := []interface{}{
		[]string{req.URL},
		map[string]interface{}{"dir": safePath},
	}
	result, err := h.callAria2cRPC("aria2.addUri", params...)
	if err != nil {
		h.logger.Error("Failed to call aria2c to start download", "url", req.URL, "path", safePath, "error", err)
		h.respondError(w, "Failed to start download: "+err.Error(), http.StatusInternalServerError)
		return
	}

	gid, ok := result.(string)
	if !ok {
		// 結果がGIDのスライスで返ってくる場合がある
		if gids, ok := result.([]interface{}); ok && len(gids) > 0 {
			if gidStr, ok := gids[0].(string); ok {
				gid = gidStr
			}
		}
	}
	if gid == "" {
		h.logger.Error("Failed to get download GID from aria2c", "result", result)
		h.respondError(w, "Failed to get download GID from aria2c", http.StatusInternalServerError)
		return
	}

	h.respondSuccess(w, map[string]string{
		"message": "Download started successfully",
		"gid":     gid,
	})
}

// GetAria2cStatus はaria2cのダウンロードステータスを取得
func (h *Handler) GetAria2cStatus(w http.ResponseWriter, r *http.Request) {
	// tellActive, tellWaiting, tellStoppedを並行して呼び出す
	type StatusResult struct {
		Name   string
		Result interface{}
		Err    error
	}

	ch := make(chan StatusResult, 3)

	methods := []string{"aria2.tellActive", "aria2.tellWaiting", "aria2.tellStopped"}
	fields := []string{"gid", "status", "totalLength", "completedLength", "downloadSpeed", "uploadSpeed", "connections", "dir", "files", "bittorrent"}

	for _, method := range methods {
		go func(m string) {
			var params []interface{}
			if m == "aria2.tellStopped" {
				// tellStoppedにはオフセットと数のパラメータが必要
				params = []interface{}{0, 100} // 最新100件
			} else {
				params = []interface{}{fields}
			}

			res, err := h.callAria2cRPC(m, params...)
			ch <- StatusResult{Name: m, Result: res, Err: err}
		}(method)
	}

	statuses := make(map[string]interface{})
	for i := 0; i < len(methods); i++ {
		res := <-ch
		if res.Err != nil {
			h.logger.Error("Failed to get aria2c status", "method", res.Name, "error", res.Err)
			// 一つのメソッドが失敗しても、他は成功する可能性があるので、エラーを返しつつも処理を続ける
			statuses[res.Name] = res.Err.Error()
		} else {
			statuses[res.Name] = res.Result
		}
	}

	h.respondSuccess(w, statuses)
}

// ControlAria2cDownload はaria2cのダウンロードを操作 (キャンセル、一時停止、再開)。
func (h *Handler) ControlAria2cDownload(w http.ResponseWriter, r *http.Request) {
	var req struct {
		GID    string `json:"gid"`
		Action string `json:"action"` // "cancel", "pause", "resume"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.logger.Error("Failed to decode aria2c control request", "error", err)
		h.respondError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.GID == "" || req.Action == "" {
		h.respondError(w, "GID and action are required", http.StatusBadRequest)
		return
	}

	var method string
	switch req.Action {
	case "cancel":
		method = "aria2.remove"
	case "pause":
		method = "aria2.pause"
	case "resume":
		method = "aria2.unpause"
	case "removeResult":
		method = "aria2.removeDownloadResult"
	default:
		h.respondError(w, "Invalid action", http.StatusBadRequest)
		return
	}

	result, err := h.callAria2cRPC(method, req.GID)
	if err != nil {
		h.logger.Error("Failed to control aria2c download", "action", req.Action, "gid", req.GID, "error", err)
		h.respondError(w, "Failed to "+req.Action+" download: "+err.Error(), http.StatusInternalServerError)
		return
	}

	h.respondSuccess(w, map[string]interface{}{
		"message": "Download " + req.Action + " successful",
		"gid":     result,
	})
}
