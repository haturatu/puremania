package handlers

import (
	"archive/zip"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"puremania/config"
	"puremania/models"
	"puremania/utils"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

// Optimized buffer sizes for different operations
const (
	SmallBufferSize = 32 * 1024       // 32KB for small files
	LargeBufferSize = 64 * 1024       // 64KB for large files
	HugeBufferSize  = 128 * 1024      // 128KB for very large files
	CacheTTL        = 5 * time.Minute // Cache TTL
)

// getOptimalBufferSize returns optimal buffer size based on file size
func getOptimalBufferSize(fileSize int64) int {
	switch {
	case fileSize < 1024*1024: // < 1MB
		return SmallBufferSize
	case fileSize < 10*1024*1024: // < 10MB
		return LargeBufferSize
	default: // >= 10MB
		return HugeBufferSize
	}
}

// 統一キャッシュエントリ（TTL付き）
type CacheEntry struct {
	Data      interface{}
	Timestamp time.Time
	Size      int64
	TTL       time.Duration
}

func (c *CacheEntry) IsExpired() bool {
	return time.Since(c.Timestamp) > c.TTL
}

// 統一TTLキャッシュ
type TTLCache struct {
	mu       sync.RWMutex
	entries  map[string]*CacheEntry
	order    []string
	maxSize  int64
	maxItems int
	curSize  int64
}

func NewTTLCache(maxSize int64, maxItems int) *TTLCache {
	cache := &TTLCache{
		entries:  make(map[string]*CacheEntry),
		order:    make([]string, 0, maxItems),
		maxSize:  maxSize,
		maxItems: maxItems,
	}

	// TTL清掃用goroutine
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

	// アクセス順序を更新
	c.mu.Lock()
	c.moveToFront(key)
	c.mu.Unlock()

	return entry.Data, true
}

func (c *TTLCache) Set(key string, data interface{}, size int64, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if existing, exists := c.entries[key]; exists {
		c.curSize -= existing.Size
		c.removeFromOrder(key)
	}

	// サイズチェック
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

// CPU論理コア数ベースのワーカープール
type WorkerPool struct {
	workers    int
	taskQueue  chan func()
	resultChan chan interface{}
	wg         sync.WaitGroup
	active     int64
}

func NewWorkerPool() *WorkerPool {
	workers := runtime.NumCPU()
	if workers > 16 { // 最大16ワーカーに制限
		workers = 16
	}
	if workers < 2 {
		workers = 2
	}

	pool := &WorkerPool{
		workers:    workers,
		taskQueue:  make(chan func(), workers*4), // バッファ付きチャネル
		resultChan: make(chan interface{}, workers*2),
	}

	for i := 0; i < workers; i++ {
		pool.wg.Add(1)
		go pool.worker()
	}

	return pool
}

func (p *WorkerPool) worker() {
	defer p.wg.Done()
	for task := range p.taskQueue {
		atomic.AddInt64(&p.active, 1)
		task()
		atomic.AddInt64(&p.active, -1)
	}
}

func (p *WorkerPool) Submit(task func()) {
	select {
	case p.taskQueue <- task:
	default:
		// タスクキューが満杯の場合は同期実行
		task()
	}
}

func (p *WorkerPool) SubmitWithResult(task func() interface{}) <-chan interface{} {
	resultChan := make(chan interface{}, 1)
	p.Submit(func() {
		result := task()
		resultChan <- result
		close(resultChan)
	})
	return resultChan
}

func (p *WorkerPool) ActiveWorkers() int64 {
	return atomic.LoadInt64(&p.active)
}

func (p *WorkerPool) Close() {
	close(p.taskQueue)
	p.wg.Wait()
	close(p.resultChan)
}

// SpecificDirInfo は、フロントエンドに渡すための特定のディレクトリ情報です。
type SpecificDirInfo struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type Handler struct {
	config     *config.Config
	cache      *TTLCache
	workerPool *WorkerPool
}

func NewHandler(config *config.Config) *Handler {
	return &Handler{
		config:     config,
		cache:      NewTTLCache(250*1024*1024, 15000), // 250MB, 15K items
		workerPool: NewWorkerPool(),
	}
}

func (h *Handler) generateDirectoryStateKey(path string) (string, error) {
	physicalPath, err := h.convertToPhysicalPath(path)
	if err != nil {
		return "", err
	}

	entries, err := os.ReadDir(physicalPath)
	if err != nil {
		// ディレクトリが存在しない場合も空のキーを返すことで、キャッシュミスを誘発
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}

	// ファイル名でソートして一貫性を保つ
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	var stateBuilder strings.Builder
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		fmt.Fprintf(&stateBuilder, "%s:%d:%d;", info.Name(), info.Size(), info.ModTime().UnixNano())
	}

	// ルートディレクトリの場合、マウントポイントの情報もキーに含める
	if path == "/" {
		// MountDirsもソートして一貫性を保つ
		sortedMounts := make([]string, len(h.config.MountDirs))
		copy(sortedMounts, h.config.MountDirs)
		sort.Strings(sortedMounts)

		for _, mountDir := range sortedMounts {
			if info, err := os.Stat(mountDir); err == nil {
				fmt.Fprintf(&stateBuilder, "mount_%s:%d:%d;", info.Name(), info.Size(), info.ModTime().UnixNano())
			}
		}
	}

	hash := md5.Sum([]byte(stateBuilder.String()))
	return hex.EncodeToString(hash[:]), nil
}

// 検索条件のハッシュ化でキー生成
func (h *Handler) generateSearchCacheKey(term, path, scope string, useRegex, caseSensitive bool, maxResults int) string {
	data := fmt.Sprintf("search:%s:%s:%s:%t:%t:%d", term, path, scope, useRegex, caseSensitive, maxResults)
	hash := md5.Sum([]byte(data))
	return "search:" + hex.EncodeToString(hash[:])
}

// 物理パスを仮想パスに変換するメソッド
func (h *Handler) convertToVirtualPath(physicalPath string) string {
	// ストレージディレクトリ内のパスの場合
	if strings.HasPrefix(physicalPath, h.config.StorageDir) {
		relPath, err := filepath.Rel(h.config.StorageDir, physicalPath)
		if err == nil {
			virtualPath := "/" + filepath.ToSlash(relPath)
			return virtualPath
		}
	}

	// マウントディレクトリの場合
	for _, mountDir := range h.config.MountDirs {
		if strings.HasPrefix(physicalPath, mountDir) {
			relPath, err := filepath.Rel(mountDir, physicalPath)
			if err == nil {
				mountName := filepath.Base(mountDir)
				virtualPath := "/" + mountName
				if relPath != "." {
					virtualPath += "/" + filepath.ToSlash(relPath)
				}
				return virtualPath
			}
		}
	}

	return physicalPath
}

// 仮想パスを物理パスに変換するメソッド
func (h *Handler) convertToPhysicalPath(virtualPath string) (string, error) {
	if virtualPath == "" || virtualPath == "/" {
		return h.config.StorageDir, nil
	}

	// SpecificDirs のチェック
	for _, specificDir := range h.config.SpecificDirs {
		dirName := filepath.Base(specificDir)
		// Note: 仮想パスはURLなので、常にスラッシュを使うべき
		virtualDirPrefix := "/" + dirName

		if virtualPath == virtualDirPrefix {
			return specificDir, nil
		}
		if strings.HasPrefix(virtualPath, virtualDirPrefix+"/") {
			// TrimPrefixは /dirName/ を取り除く
			relPath := strings.TrimPrefix(virtualPath, virtualDirPrefix+"/")
			// filepath.JoinはOS依存のセパレータを使うので正しい
			return filepath.Join(specificDir, relPath), nil
		}
	}

	// マウントポイントのチェック
	parts := strings.Split(strings.Trim(virtualPath, "/"), "/")
	if len(parts) > 0 {
		mountName := parts[0]
		for _, mountDir := range h.config.MountDirs {
			if filepath.Base(mountDir) == mountName {
				if len(parts) == 1 {
					return mountDir, nil
				} else {
					relPath := strings.Join(parts[1:], "/")
					return filepath.Join(mountDir, relPath), nil
				}
			}
		}
	}

	// デフォルトはストレージディレクトリ内
	return filepath.Join(h.config.StorageDir, strings.TrimPrefix(virtualPath, "/")), nil
}

// ListFiles - 並列処理とTTLキャッシュ、ETagによる差分検知を使用
func (h *Handler) ListFiles(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/"
	}

	// 1. 現在のディレクトリ状態からETagを生成
	currentStateKey, err := h.generateDirectoryStateKey(path)
	if err != nil {
		// ETag生成に失敗した場合は、キャッシュを使わずに通常処理
		h.serveFreshFileList(w, path, "") // ETagなしで提供
		return
	}

	// 2. クライアントのETagと比較
	clientEtag := r.Header.Get("If-None-Match")
	if clientEtag != "" && clientEtag == currentStateKey {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	// 3. ETagが不一致、または存在しない場合 -> 新しいレスポンスを生成
	w.Header().Set("ETag", currentStateKey)

	// 4. ETagに基づいたキャッシュを確認
	cacheKey := "list:" + currentStateKey // キーはETagだけで十分
	if cached, found := h.cache.Get(cacheKey); found {
		if fileInfos, ok := cached.([]models.FileInfo); ok {
			h.respondSuccess(w, fileInfos)
			return
		}
	}

	// 5. キャッシュがない場合は、新しいファイルリストを生成
	h.serveFreshFileList(w, path, currentStateKey)
}

// serveFreshFileList は新しいファイルリストを生成し、必要に応じてキャッシュに保存する
func (h *Handler) serveFreshFileList(w http.ResponseWriter, path string, etag string) {
	fileInfos, err := h.getFileList(path)
	if err != nil {
		if os.IsNotExist(err) {
			h.respondError(w, "Directory not found", http.StatusNotFound)
		} else {
			h.respondError(w, "Cannot read directory", http.StatusInternalServerError)
		}
		return
	}

	// 結果をキャッシュ（ETagがあれば）
	if etag != "" {
		cacheKey := "list:" + etag
		// size of fileInfos is roughly len(fileInfos) * 200 bytes
		h.cache.Set(cacheKey, fileInfos, int64(len(fileInfos)*200), CacheTTL)
	}

	h.respondSuccess(w, fileInfos)
}

func (h *Handler) getFileList(path string) ([]models.FileInfo, error) {
	var fileInfos []models.FileInfo

	// 通常のパス処理 (convertToPhysicalPathがすべてを処理する)
	fullPath, err := h.convertToPhysicalPath(path)
	if err != nil {
		return nil, err
	}

	// パスが存在するか確認
	if _, err := os.Stat(fullPath); os.IsNotExist(err) {
		return nil, err
	}

	// ルートディレクトリの場合はマウントポイントも表示
	if path == "/" {
		for _, mountDir := range h.config.MountDirs {
			if info, err := os.Stat(mountDir); err == nil {
				virtualPath := h.convertToVirtualPath(mountDir)
				fileInfos = append(fileInfos, models.FileInfo{
					Name:    filepath.Base(mountDir),
					Path:    virtualPath,
					Size:    info.Size(),
					ModTime: info.ModTime().Format(time.RFC3339),
					IsDir:   true,
					IsMount: true,
				})
			}
		}
	}

	if entries, err := os.ReadDir(fullPath); err == nil {
		directoryFileInfos := h.processDirectoryEntries(entries, fullPath)
		fileInfos = append(fileInfos, directoryFileInfos...)
		return fileInfos, nil
	} else {
		return nil, err
	}
}

func (h *Handler) processDirectoryEntries(entries []os.DirEntry, basePath string) []models.FileInfo {
	var fileInfos []models.FileInfo
	var mu sync.Mutex
	var wg sync.WaitGroup

	// 並列処理でエントリーを処理
	for _, entry := range entries {
		wg.Add(1)
		h.workerPool.Submit(func() {
			defer wg.Done()

			var size int64
			var modTime time.Time

			if entry.Type().IsRegular() || entry.IsDir() {
				if info, err := entry.Info(); err == nil {
					size = info.Size()
					modTime = info.ModTime()
				}
			}

			mimeType := "application/octet-stream"
			isEditable := false

			if !entry.IsDir() {
				mimeType = mime.TypeByExtension(filepath.Ext(entry.Name()))
				if mimeType == "" {
					mimeType = "application/octet-stream"
				}
				isEditable = utils.IsTextFile(mimeType) || utils.IsEditableByExtension(entry.Name())
			}

			physicalFilepath := filepath.Join(basePath, entry.Name())
			virtualPath := h.convertToVirtualPath(physicalFilepath)

			// マウントポイントかどうかを判定
			isMount := false
			for _, mountDir := range h.config.MountDirs {
				if physicalFilepath == mountDir {
					isMount = true
					break
				}
			}

			fileInfo := models.FileInfo{
				Name:       entry.Name(),
				Path:       virtualPath,
				Size:       size,
				ModTime:    modTime.Format(time.RFC3339),
				IsDir:      entry.IsDir(),
				MimeType:   mimeType,
				IsEditable: isEditable,
				IsMount:    isMount, // マウントポイントフラグを設定
			}

			mu.Lock()
			fileInfos = append(fileInfos, fileInfo)
			mu.Unlock()
		})
	}

	wg.Wait()
	return fileInfos
}

// UploadFile - 並列処理でファイルアップロード
func (h *Handler) UploadFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if err := r.ParseMultipartForm(h.config.MaxFileSize << 20); err != nil {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
		h.respondError(w, "File is too large", http.StatusBadRequest)
		return
	}
	defer func() {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
	}()

	path := r.FormValue("path")
	if path == "" {
		path = "/"
	}

	fullPath, err := h.convertToPhysicalPath(path)
	if err != nil {
		h.respondError(w, "Invalid path: "+err.Error(), http.StatusBadRequest)
		return
	}

	if err := os.MkdirAll(fullPath, 0755); err != nil {
		h.respondError(w, "Cannot create directory", http.StatusInternalServerError)
		return
	}

	files := r.MultipartForm.File["file"]
	relativePaths := r.MultipartForm.Value["relativePath[]"]

	if len(files) != len(relativePaths) {
		h.respondError(w, "Mismatch between files and relative paths", http.StatusBadRequest)
		return
	}

	// 並列アップロード処理
	resultChan := make(chan uploadResult, len(files))
	var wg sync.WaitGroup

	for i, fileHeader := range files {
		wg.Add(1)
		index := i
		h.workerPool.Submit(func() {
			defer wg.Done()

			file, err := fileHeader.Open()
			if err != nil {
				resultChan <- uploadResult{path: fileHeader.Filename, success: false}
				return
			}
			defer file.Close()

			relativePath := relativePaths[index]
			normalizedRelativePath := filepath.FromSlash(relativePath)
			targetPath := filepath.Join(fullPath, normalizedRelativePath)
			targetDir := filepath.Dir(targetPath)

			if err := os.MkdirAll(targetDir, 0755); err != nil {
				resultChan <- uploadResult{path: relativePath, success: false}
				return
			}

			// ファイル作成
			dst, err := os.Create(targetPath)
			if err != nil {
				resultChan <- uploadResult{path: relativePath, success: false}
				return
			}
			defer func() {
				_ = dst.Close()
			}()

			// ファイルサイズに応じた最適な保存方法を選択
			const MiB = 1 << 20
			const Threshold = 500 * MiB
			var saveErr error

			if fileHeader.Size > Threshold {
				// 大きいファイルはストリームコピー
				_, saveErr = io.Copy(dst, file)
			} else {
				// 小さいファイルは一括読み込み
				data, err := io.ReadAll(file)
				if err != nil {
					saveErr = err
				} else {
					_, saveErr = dst.Write(data)
				}
			}

			// エラーチェック
			if saveErr != nil {
				// エラー時は作成したファイルを削除
				os.Remove(targetPath)
				resultChan <- uploadResult{path: relativePath, success: false}
				return
			}

			virtualPath := h.convertToVirtualPath(targetPath)
			resultChan <- uploadResult{path: virtualPath, success: true}

			// キャッシュクリア
			h.cache.InvalidateByPrefix("list:" + filepath.Dir(h.convertToVirtualPath(targetDir)))
		})
	}

	// 結果収集
	go func() {
		wg.Wait()
		close(resultChan)
	}()

	uploadedFiles := make([]string, 0)
	failedFiles := make([]string, 0)

	for result := range resultChan {
		if result.success {
			uploadedFiles = append(uploadedFiles, result.path)
		} else {
			failedFiles = append(failedFiles, result.path)
		}
	}

	response := map[string]interface{}{
		"message":      fmt.Sprintf("Uploaded %d file(s) successfully", len(uploadedFiles)),
		"uploaded":     uploadedFiles,
		"failed":       failedFiles,
		"total":        len(files),
		"successful":   len(uploadedFiles),
		"failed_count": len(failedFiles),
	}

	h.respondSuccess(w, response)
}

type uploadResult struct {
	path    string
	success bool
}

// DownloadFile - http.ServeContentを使用してsendfile最適化
func (h *Handler) DownloadFile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		h.respondError(w, "Path required", http.StatusBadRequest)
		return
	}

	fullPath, err := h.convertToPhysicalPath(path)
	if err != nil {
		h.respondError(w, "Invalid path: "+err.Error(), http.StatusBadRequest)
		return
	}

	file, err := os.Open(fullPath)
	if err != nil {
		h.respondError(w, "Cannot open file", http.StatusNotFound)
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		h.respondError(w, "Cannot get file info", http.StatusInternalServerError)
		return
	}

	if stat.IsDir() {
		h.respondError(w, "Cannot download directory", http.StatusBadRequest)
		return
	}

	contentType := mime.TypeByExtension(filepath.Ext(path))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	filename := filepath.Base(path)
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", filename))

	// http.ServeContentを使用してsendfile最適化とRange/If-Modified-Since自動処理
	http.ServeContent(w, r, filename, stat.ModTime(), file)
}

// GetFileContent - 画像はhttp.ServeFileで最適化、テキストはキャッシュ使用
func (h *Handler) GetFileContent(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		h.respondError(w, "Path required", http.StatusBadRequest)
		return
	}

	fullPath, err := h.convertToPhysicalPath(path)
	if err != nil {
		h.respondError(w, "Invalid path: "+err.Error(), http.StatusBadRequest)
		return
	}

	stat, err := os.Stat(fullPath)
	if err != nil {
		h.respondError(w, "Cannot get file info", http.StatusNotFound)
		return
	}

	if stat.IsDir() {
		h.respondError(w, "Cannot get content of directory", http.StatusBadRequest)
		return
	}

	mimeType := mime.TypeByExtension(filepath.Ext(path))

	// 画像ファイルの場合はhttp.ServeFileで最適化
	if mimeType != "" && strings.HasPrefix(mimeType, "image/") {
		w.Header().Set("Cache-Control", "max-age=3600")
		http.ServeFile(w, r, fullPath)
		return
	}

	if stat.Size() > 10*1024*1024 { // 10MB limit
		h.respondError(w, "File too large for editing (max 10MB)", http.StatusBadRequest)
		return
	}

	// キャッシュチェック
	cacheKey := "content:" + path + ":" + strconv.FormatInt(stat.ModTime().Unix(), 10)
	if cached, found := h.cache.Get(cacheKey); found {
		if content, ok := cached.(string); ok {
			h.respondSuccess(w, map[string]string{
				"content": content,
				"path":    path,
			})
			return
		}
	}

	// 並列処理でファイル読み込み
	resultChan := h.workerPool.SubmitWithResult(func() interface{} {
		content, err := os.ReadFile(fullPath)
		if err != nil {
			return nil
		}
		return string(content)
	})

	result := <-resultChan
	if contentStr, ok := result.(string); ok {
		// コンテンツをキャッシュ（TTL付き）
		h.cache.Set(cacheKey, contentStr, stat.Size(), CacheTTL)

		h.respondSuccess(w, map[string]string{
			"content": contentStr,
			"path":    path,
		})
	} else {
		h.respondError(w, "Cannot read file", http.StatusInternalServerError)
	}
}

// DownloadZip - 並列処理でZIPストリーミング配信
func (h *Handler) DownloadZip(w http.ResponseWriter, r *http.Request) {
	var req models.BatchPathsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if len(req.Paths) == 0 {
		h.respondError(w, "No paths provided", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=\"files.zip\"")
	w.Header().Set("Transfer-Encoding", "chunked")

	// io.Pipeでストリーミング
	pr, pw := io.Pipe()

	// 並列処理でzip作成
	go func() {
		defer pw.Close()
		h.createZipArchive(pw, req.Paths)
	}()

	// ストリーミング出力
	io.Copy(w, pr)
}

func (h *Handler) createZipArchive(w io.Writer, paths []string) {
	zipWriter := zip.NewWriter(w)
	defer zipWriter.Close()

	var successfulFiles, failedFiles int64
	var mu sync.Mutex
	var wg sync.WaitGroup

	// 並列処理でファイルをZIPに追加
	for _, userPath := range paths {
		wg.Add(1)
		h.workerPool.Submit(func() {
			defer wg.Done()

			fullPath, err := h.convertToPhysicalPath(userPath)
			if err != nil {
				atomic.AddInt64(&failedFiles, 1)
				return
			}

			fileInfo, err := os.Stat(fullPath)
			if err != nil {
				atomic.AddInt64(&failedFiles, 1)
				return
			}

			if fileInfo.IsDir() {
				// ディレクトリの場合は並列WalkDir
				h.addDirectoryToZip(zipWriter, fullPath, &successfulFiles, &failedFiles, &mu)
			} else {
				// 単一ファイルの処理
				if h.addFileToZip(zipWriter, fullPath, filepath.Base(userPath), &mu) {
					atomic.AddInt64(&successfulFiles, 1)
				} else {
					atomic.AddInt64(&failedFiles, 1)
				}
			}
		})
	}

	wg.Wait()
}

func (h *Handler) addDirectoryToZip(zipWriter *zip.Writer, dirPath string, successfulFiles, failedFiles *int64, mu *sync.Mutex) {
	var wg sync.WaitGroup

	filepath.WalkDir(dirPath, func(filePath string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}

		relPath, err := filepath.Rel(filepath.Dir(dirPath), filePath)
		if err != nil {
			return err
		}

		if dirPath == filePath {
			relPath = filepath.Base(dirPath)
		} else {
			relPath = filepath.Join(filepath.Base(dirPath), relPath)
		}

		if d.IsDir() {
			// ディレクトリエントリの作成
			header := &zip.FileHeader{
				Name:   filepath.ToSlash(relPath) + "/",
				Method: zip.Store,
			}
			if info, err := d.Info(); err == nil {
				header.Modified = info.ModTime()
			}

			mu.Lock()
			zipWriter.CreateHeader(header)
			mu.Unlock()
			return nil
		}

		// 並列処理でファイルを追加
		wg.Add(1)
		h.workerPool.Submit(func() {
			defer wg.Done()
			if h.addFileToZip(zipWriter, filePath, relPath, mu) {
				atomic.AddInt64(successfulFiles, 1)
			} else {
				atomic.AddInt64(failedFiles, 1)
			}
		})

		return nil
	})

	wg.Wait()
}

func (h *Handler) addFileToZip(zipWriter *zip.Writer, filePath, zipPath string, mu *sync.Mutex) bool {
	info, err := os.Stat(filePath)
	if err != nil {
		return false
	}

	header, err := zip.FileInfoHeader(info)
	if err != nil {
		return false
	}

	header.Name = filepath.ToSlash(zipPath)
	header.Method = zip.Deflate

	mu.Lock()
	writer, err := zipWriter.CreateHeader(header)
	mu.Unlock()

	if err != nil {
		return false
	}

	file, err := os.Open(filePath)
	if err != nil {
		return false
	}
	defer file.Close()

	// バッファサイズ最適化
	bufferSize := getOptimalBufferSize(info.Size())
	buffer := make([]byte, bufferSize)

	mu.Lock()
	_, err = io.CopyBuffer(writer, file, buffer)
	mu.Unlock()

	return err == nil
}

func (h *Handler) SaveFile(w http.ResponseWriter, r *http.Request) {
	var req models.SaveFileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		h.respondError(w, "Path required", http.StatusBadRequest)
		return
	}

	fullPath, err := h.convertToPhysicalPath(req.Path)
	if err != nil {
		h.respondError(w, "Invalid path: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 並列処理でファイル保存
	resultChan := h.workerPool.SubmitWithResult(func() interface{} {
		err := os.WriteFile(fullPath, []byte(req.Content), 0644)
		return err
	})

	result := <-resultChan
	if err, ok := result.(error); ok && err != nil {
		h.respondError(w, "Cannot save file", http.StatusInternalServerError)
		return
	}

	// キャッシュを無効化
	h.invalidateFileCache(fullPath)

	h.respondSuccess(w, map[string]string{"message": "File saved successfully"})
}

func (h *Handler) DeleteMultipleFiles(w http.ResponseWriter, r *http.Request) {
	var req models.BatchPathsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	// 並列処理で削除
	var errors []string
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, path := range req.Paths {
		wg.Add(1)
		h.workerPool.Submit(func() {
			defer wg.Done()

			fullPath, err := h.convertToPhysicalPath(path)
			if err != nil {
				mu.Lock()
				errors = append(errors, fmt.Sprintf("Invalid path %s: %v", path, err))
				mu.Unlock()
				return
			}

			err = os.RemoveAll(fullPath)
			if err != nil {
				mu.Lock()
				errors = append(errors, fmt.Sprintf("Cannot delete %s: %v", path, err))
				mu.Unlock()
			} else {
				// キャッシュを無効化
				h.invalidateFileCache(fullPath)
				h.cache.InvalidateByPrefix("list:" + filepath.Dir(h.convertToVirtualPath(fullPath)))
			}
		})
	}

	wg.Wait()

	if len(errors) > 0 {
		h.respondError(w, strings.Join(errors, "\n"), http.StatusInternalServerError)
		return
	}

	h.respondSuccess(w, map[string]string{"message": "Selected items deleted successfully"})
}

func (h *Handler) CreateDirectory(w http.ResponseWriter, r *http.Request) {
	var req models.CreateDirectoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	parentPath, err := h.convertToPhysicalPath(req.Path)
	if err != nil {
		h.respondError(w, "Invalid base path: "+err.Error(), http.StatusBadRequest)
		return
	}

	newDirPath := filepath.Join(parentPath, req.Name)
	if strings.Contains(req.Name, "..") {
		h.respondError(w, "Invalid directory name", http.StatusBadRequest)
		return
	}

	// 並列処理でディレクトリ作成
	resultChan := h.workerPool.SubmitWithResult(func() interface{} {
		return os.MkdirAll(newDirPath, 0755)
	})

	result := <-resultChan
	if err, ok := result.(error); ok && err != nil {
		h.respondError(w, "Cannot create directory", http.StatusInternalServerError)
		return
	}

	// 親ディレクトリのキャッシュを無効化
	h.cache.InvalidateByPrefix("list:" + h.convertToVirtualPath(parentPath))

	h.respondSuccess(w, map[string]string{"message": "Directory created successfully"})
}

// ファイル移動機能
func (h *Handler) MoveFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SourcePath string `json:"sourcePath"`
		TargetPath string `json:"targetPath"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.SourcePath == "" || req.TargetPath == "" {
		h.respondError(w, "Source and target paths required", http.StatusBadRequest)
		return
	}

	sourceFullPath, err := h.convertToPhysicalPath(req.SourcePath)
	if err != nil {
		h.respondError(w, "Invalid source path: "+err.Error(), http.StatusBadRequest)
		return
	}

	targetFullPath, err := h.convertToPhysicalPath(req.TargetPath)
	if err != nil {
		h.respondError(w, "Invalid target path: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 並列処理でファイル移動
	resultChan := h.workerPool.SubmitWithResult(func() interface{} {
		// ターゲットディレクトリが存在するか確認
		if _, err := os.Stat(filepath.Dir(targetFullPath)); os.IsNotExist(err) {
			return fmt.Errorf("target directory does not exist")
		}

		// ファイル移動
		return os.Rename(sourceFullPath, targetFullPath)
	})

	result := <-resultChan
	if err, ok := result.(error); ok && err != nil {
		h.respondError(w, "Cannot move file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// キャッシュを無効化
	h.invalidateFileCache(sourceFullPath)
	h.invalidateFileCache(targetFullPath)
	h.cache.InvalidateByPrefix("list:" + filepath.Dir(h.convertToVirtualPath(sourceFullPath)))
	h.cache.InvalidateByPrefix("list:" + filepath.Dir(h.convertToVirtualPath(targetFullPath)))

	h.respondSuccess(w, map[string]string{"message": "File moved successfully"})
}

// 新規ファイル作成機能
func (h *Handler) CreateFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path    string `json:"path"`
		Name    string `json:"name"`
		Content string `json:"content,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Path == "" || req.Name == "" {
		h.respondError(w, "Path and name required", http.StatusBadRequest)
		return
	}

	parentPath, err := h.convertToPhysicalPath(req.Path)
	if err != nil {
		h.respondError(w, "Invalid path: "+err.Error(), http.StatusBadRequest)
		return
	}

	// デフォルトで.md拡張子を追加
	if !strings.Contains(req.Name, ".") {
		req.Name += ".md"
	}

	newFilePath := filepath.Join(parentPath, req.Name)
	if strings.Contains(req.Name, "..") {
		h.respondError(w, "Invalid file name", http.StatusBadRequest)
		return
	}

	// 並列処理でファイル作成
	resultChan := h.workerPool.SubmitWithResult(func() interface{} {
		// ファイルが既に存在するか確認
		if _, err := os.Stat(newFilePath); err == nil {
			return fmt.Errorf("file already exists")
		}

		// デフォルトコンテンツ
		content := req.Content
		if content == "" {
			content = "# " + strings.TrimSuffix(req.Name, filepath.Ext(req.Name)) + "\n\n"
		}

		return os.WriteFile(newFilePath, []byte(content), 0644)
	})

	result := <-resultChan
	if err, ok := result.(error); ok && err != nil {
		if strings.Contains(err.Error(), "already exists") {
			h.respondError(w, "File already exists", http.StatusBadRequest)
		} else {
			h.respondError(w, "Cannot create file", http.StatusInternalServerError)
		}
		return
	}

	// 親ディレクトリのキャッシュを無効化
	h.cache.InvalidateByPrefix("list:" + h.convertToVirtualPath(parentPath))

	// 仮想パスを返す
	virtualPath := h.convertToVirtualPath(newFilePath)

	h.respondSuccess(w, map[string]string{
		"message": "File created successfully",
		"path":    virtualPath,
	})
}

func (h *Handler) GetConfig(w http.ResponseWriter, r *http.Request) {
	h.respondSuccess(w, h.config)
}

// SearchFiles - 並列処理と細かいキャッシュキー使用
func (h *Handler) SearchFiles(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Term          string `json:"term"`
		Path          string `json:"path"`
		Scope         string `json:"scope"`
		UseRegex      bool   `json:"useRegex"`
		CaseSensitive bool   `json:"caseSensitive"`
		MaxResults    int    `json:"maxResults"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Term == "" {
		h.respondError(w, "Search term required", http.StatusBadRequest)
		return
	}

	if req.MaxResults == 0 {
		req.MaxResults = 1000
	}

	// 細かいキャッシュキーを生成
	cacheKey := h.generateSearchCacheKey(req.Term, req.Path, req.Scope, req.UseRegex, req.CaseSensitive, req.MaxResults)
	if cached, found := h.cache.Get(cacheKey); found {
		if results, ok := cached.([]models.FileInfo); ok {
			h.respondSuccess(w, results)
			return
		}
	}

	basePath, err := h.convertToPhysicalPath(req.Path)
	if err != nil {
		h.respondError(w, "Invalid path", http.StatusBadRequest)
		return
	}

	// 並列処理で検索実行
	resultChan := h.workerPool.SubmitWithResult(func() interface{} {
		return h.performSearch(req, basePath)
	})

	result := <-resultChan
	if results, ok := result.([]models.FileInfo); ok {
		// 結果をキャッシュ（検索結果は短めのTTL）
		h.cache.Set(cacheKey, results, int64(len(results)*200), time.Minute*2)
		h.respondSuccess(w, results)
	} else {
		h.respondError(w, "Search failed", http.StatusInternalServerError)
	}
}

func (h *Handler) performSearch(req struct {
	Term          string `json:"term"`
	Path          string `json:"path"`
	Scope         string `json:"scope"`
	UseRegex      bool   `json:"useRegex"`
	CaseSensitive bool   `json:"caseSensitive"`
	MaxResults    int    `json:"maxResults"`
}, basePath string) []models.FileInfo {
	var searchFunc func(string) bool

	if req.UseRegex {
		var regex *regexp.Regexp
		var err error
		if req.CaseSensitive {
			regex, err = regexp.Compile(req.Term)
		} else {
			regex, err = regexp.Compile("(?i)" + req.Term)
		}
		if err != nil {
			return []models.FileInfo{}
		}
		searchFunc = func(name string) bool {
			return regex.MatchString(name)
		}
	} else {
		if req.CaseSensitive {
			searchFunc = func(name string) bool {
				return strings.Contains(name, req.Term)
			}
		} else {
			lowerTerm := strings.ToLower(req.Term)
			searchFunc = func(name string) bool {
				return strings.Contains(strings.ToLower(name), lowerTerm)
			}
		}
	}

	if req.Scope == "recursive" {
		return h.searchRecursiveParallel(basePath, searchFunc, req.MaxResults)
	} else {
		return h.searchCurrentParallel(basePath, searchFunc, req.MaxResults)
	}
}

// searchCurrentParallel - 並列処理で現在ディレクトリ検索
func (h *Handler) searchCurrentParallel(path string, matchFunc func(string) bool, maxResults int) []models.FileInfo {
	var results []models.FileInfo
	var mu sync.Mutex

	entries, err := os.ReadDir(path)
	if err != nil {
		return results
	}

	var wg sync.WaitGroup
	resultCount := int64(0)

	for _, entry := range entries {
		if atomic.LoadInt64(&resultCount) >= int64(maxResults) {
			break
		}

		wg.Add(1)
		h.workerPool.Submit(func() {
			defer wg.Done()

			if atomic.LoadInt64(&resultCount) >= int64(maxResults) {
				return
			}

			if matchFunc(entry.Name()) {
				var size int64
				var modTime time.Time

				if entry.Type().IsRegular() || entry.IsDir() {
					if info, err := entry.Info(); err == nil {
						size = info.Size()
						modTime = info.ModTime()
					}
				}

				mimeType := mime.TypeByExtension(filepath.Ext(entry.Name()))
				if mimeType == "" {
					mimeType = "application/octet-stream"
				}

				fullPath := filepath.Join(path, entry.Name())
				virtualPath := h.convertToVirtualPath(fullPath)

				fileInfo := models.FileInfo{
					Name:       entry.Name(),
					Path:       virtualPath,
					Size:       size,
					ModTime:    modTime.Format(time.RFC3339),
					IsDir:      entry.IsDir(),
					MimeType:   mimeType,
					IsEditable: utils.IsTextFile(mimeType) || utils.IsEditableByExtension(entry.Name()),
				}

				mu.Lock()
				if len(results) < maxResults {
					results = append(results, fileInfo)
					atomic.AddInt64(&resultCount, 1)
				}
				mu.Unlock()
			}
		})
	}

	wg.Wait()
	return results
}

// searchRecursiveParallel - 並列処理で再帰検索
func (h *Handler) searchRecursiveParallel(path string, matchFunc func(string) bool, maxResults int) []models.FileInfo {
	var results []models.FileInfo
	var mu sync.Mutex
	resultCount := int64(0)

	var wg sync.WaitGroup

	err := filepath.WalkDir(path, func(filePath string, d os.DirEntry, err error) error {
		if err != nil {
			return nil // エラーをスキップして継続
		}

		if atomic.LoadInt64(&resultCount) >= int64(maxResults) {
			return filepath.SkipAll
		}

		if matchFunc(d.Name()) {
			wg.Add(1)
			h.workerPool.Submit(func() {
				defer wg.Done()

				if atomic.LoadInt64(&resultCount) >= int64(maxResults) {
					return
				}

				var size int64
				var modTime time.Time

				if d.Type().IsRegular() || d.IsDir() {
					if info, err := d.Info(); err == nil {
						size = info.Size()
						modTime = info.ModTime()
					}
				}

				mimeType := mime.TypeByExtension(filepath.Ext(d.Name()))
				if mimeType == "" {
					mimeType = "application/octet-stream"
				}

				virtualPath := h.convertToVirtualPath(filePath)

				fileInfo := models.FileInfo{
					Name:       d.Name(),
					Path:       virtualPath,
					Size:       size,
					ModTime:    modTime.Format(time.RFC3339),
					IsDir:      d.IsDir(),
					MimeType:   mimeType,
					IsEditable: utils.IsTextFile(mimeType) || utils.IsEditableByExtension(d.Name()),
				}

				mu.Lock()
				if atomic.LoadInt64(&resultCount) < int64(maxResults) {
					results = append(results, fileInfo)
					atomic.AddInt64(&resultCount, 1)
				}
				mu.Unlock()
			})
		}

		return nil
	})

	if err != nil {
		fmt.Printf("Recursive search error: %v\n", err)
	}

	wg.Wait()

	// 結果をソート
	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})

	return results
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
		h.cache.Set(cacheKey, storageInfo, 1024, CacheTTL)
		h.respondSuccess(w, storageInfo)
	} else {
		h.respondError(w, "Cannot get storage info", http.StatusInternalServerError)
	}
}

// キャッシュ無効化メソッド
func (h *Handler) invalidateFileCache(filePath string) {
	virtualPath := h.convertToVirtualPath(filePath)

	// ファイル関連のキャッシュを無効化
	h.cache.InvalidateByPrefix("content:" + virtualPath)
	h.cache.InvalidateByPrefix("list:" + filepath.Dir(virtualPath))
}

// バッチ処理用の新しいメソッド
func (h *Handler) ProcessBatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Operations []struct {
			Type string                 `json:"type"`
			Data map[string]interface{} `json:"data"`
		} `json:"operations"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	results := make([]map[string]interface{}, len(req.Operations))
	var mu sync.Mutex
	var wg sync.WaitGroup

	// 並列処理でバッチ操作を実行
	for i, op := range req.Operations {
		wg.Add(1)
		h.workerPool.Submit(func() {
			defer wg.Done()

			result := h.processOperation(op.Type, op.Data)

			mu.Lock()
			results[i] = result
			mu.Unlock()
		})
	}

	wg.Wait()

	h.respondSuccess(w, map[string]interface{}{
		"results": results,
		"total":   len(req.Operations),
	})
}

func (h *Handler) processOperation(opType string, data map[string]interface{}) map[string]interface{} {
	result := map[string]interface{}{
		"type":    opType,
		"success": false,
	}

	switch opType {
	case "delete":
		if path, ok := data["path"].(string); ok {
			if fullPath, err := h.convertToPhysicalPath(path); err == nil {
				if err := os.RemoveAll(fullPath); err == nil {
					h.invalidateFileCache(fullPath)
					result["success"] = true
					result["message"] = "File deleted successfully"
				} else {
					result["error"] = err.Error()
				}
			} else {
				result["error"] = "Invalid path"
			}
		}
	case "move":
		if src, srcOk := data["source"].(string); srcOk {
			if dst, dstOk := data["destination"].(string); dstOk {
				srcPath, srcErr := h.convertToPhysicalPath(src)
				dstPath, dstErr := h.convertToPhysicalPath(dst)

				if srcErr == nil && dstErr == nil {
					if err := os.Rename(srcPath, dstPath); err == nil {
						h.invalidateFileCache(srcPath)
						h.invalidateFileCache(dstPath)
						result["success"] = true
						result["message"] = "File moved successfully"
					} else {
						result["error"] = err.Error()
					}
				} else {
					result["error"] = "Invalid paths"
				}
			}
		}
	default:
		result["error"] = "Unknown operation type"
	}

	return result
}

// ヘルスチェック用エンドポイント
func (h *Handler) HealthCheck(w http.ResponseWriter, r *http.Request) {
	status := map[string]interface{}{
		"status":         "healthy",
		"timestamp":      time.Now().Format(time.RFC3339),
		"active_workers": h.workerPool.ActiveWorkers(),
		"cache_stats": map[string]interface{}{
			"entries": len(h.cache.entries),
			"size":    h.cache.curSize,
		},
	}

	h.respondSuccess(w, status)
}

// GetSpecificDirs は、設定された特定のディレクトリのリストを返します。
func (h *Handler) GetSpecificDirs(w http.ResponseWriter, r *http.Request) {
	dirs := h.config.SpecificDirs
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

func (h *Handler) respondSuccess(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(models.APIResponse{
		Success: true,
		Data:    data,
	})
}

func (h *Handler) respondError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(models.APIResponse{
		Success: false,
		Message: message,
	})
}

func IsEditableByExtension(filename string) bool {
	editableExts := []string{
		".txt", ".md", ".markdown", ".json", ".xml", ".yaml", ".yml",
		".html", ".htm", ".css", ".js", ".jsx", ".ts", ".tsx",
		".py", ".java", ".c", ".cpp", ".h", ".hpp", ".go", ".rs",
		".php", ".rb", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".cmd",
		".sql", ".conf", ".config", ".ini", ".env", ".dockerfile",
		".gitignore", ".gitattributes", ".editorconfig", ".prettierrc",
		".eslintrc", ".babelrc", ".npmrc", ".yarnrc", ".toml",
	}

	ext := strings.ToLower(filepath.Ext(filename))
	for _, editableExt := range editableExts {
		if ext == editableExt {
			return true
		}
	}

	return false
}
