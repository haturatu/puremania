package handlers

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"puremania/cache"
	"puremania/types"
	"puremania/utils"
	"puremania/worker"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/mux"

	"github.com/mholt/archives"
)

const (
	thumbnailDir                   = ".cache/thumbnails"
	thumbnailMaxBytes        int64 = 256 << 20
	thumbnailMaxFiles              = 4096
	thumbnailCleanupInterval       = 5 * time.Minute
	thumbnailTempTTL               = 10 * time.Minute
)

type thumbnailCacheEntry struct {
	path    string
	size    int64
	modTime time.Time
}

func cleanupThumbnailCache(dir string, maxBytes int64, maxFiles int) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}

	now := time.Now()
	cacheEntries := make([]thumbnailCacheEntry, 0, len(entries))
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if strings.HasPrefix(entry.Name(), ".thumbnail-") {
			if now.Sub(info.ModTime()) >= thumbnailTempTTL {
				_ = os.Remove(filepath.Join(dir, entry.Name()))
			}
			continue
		}
		if !strings.HasSuffix(entry.Name(), ".jpg") || !info.Mode().IsRegular() {
			continue
		}
		cacheEntries = append(cacheEntries, thumbnailCacheEntry{
			path:    filepath.Join(dir, entry.Name()),
			size:    info.Size(),
			modTime: info.ModTime(),
		})
	}

	sort.Slice(cacheEntries, func(i, j int) bool {
		return cacheEntries[i].modTime.Before(cacheEntries[j].modTime)
	})

	var totalBytes int64
	for _, entry := range cacheEntries {
		totalBytes += entry.size
	}
	for len(cacheEntries) > 0 && (totalBytes > maxBytes || len(cacheEntries) > maxFiles) {
		oldest := cacheEntries[0]
		cacheEntries = cacheEntries[1:]
		if err := os.Remove(oldest.path); err != nil && !os.IsNotExist(err) {
			return err
		}
		totalBytes -= oldest.size
	}
	return nil
}

func (h *Handler) cleanupThumbnailCacheIfDue(dir string, force bool) error {
	h.thumbnailCleanupMu.Lock()
	defer h.thumbnailCleanupMu.Unlock()

	now := time.Now()
	if !force && now.Sub(h.lastThumbnailCleanup) < thumbnailCleanupInterval {
		return nil
	}
	h.lastThumbnailCleanup = now
	return cleanupThumbnailCache(dir, thumbnailMaxBytes, thumbnailMaxFiles)
}

func (h *Handler) generateThumbnail(ctx context.Context, videoPath, thumbnailPath string, extraFiles ...*os.File) error {
	// ffmpeg command to generate thumbnail
	cmd := exec.CommandContext(ctx, "ffmpeg", "-i", videoPath, "-ss", "00:00:01", "-vframes", "1", "-vf", "thumbnail,scale=320:-1", "-y", thumbnailPath)
	cmd.ExtraFiles = extraFiles
	output, err := cmd.CombinedOutput()
	if err != nil {
		// Check if the error is due to context timeout
		if ctx.Err() == context.DeadlineExceeded {
			return fmt.Errorf("ffmpeg command timed out")
		}
		return fmt.Errorf("failed to generate thumbnail: %w. Output: %s", err, string(output))
	}
	return nil
}

func (h *Handler) Thumbnail(w http.ResponseWriter, r *http.Request) {
	// ensure thumbnail directory exists
	if err := os.MkdirAll(thumbnailDir, 0755); err != nil {
		h.logger.Error("Failed to create thumbnail directory", "path", thumbnailDir, "error", err)
		h.respondError(w, "Cannot create thumbnail directory", http.StatusInternalServerError)
		return
	}
	if err := h.cleanupThumbnailCacheIfDue(thumbnailDir, false); err != nil {
		h.logger.Warn("Failed to clean thumbnail cache", "path", thumbnailDir, "error", err)
	}

	path := r.URL.Query().Get("path")
	if path == "" {
		h.respondError(w, "Path required", http.StatusBadRequest)
		return
	}
	if len(path) > maxVirtualPathBytes {
		h.respondError(w, "Path is too long", http.StatusBadRequest)
		return
	}

	fullPath, err := h.convertToPhysicalPath(path)
	if err != nil {
		h.logger.Error("Invalid path for thumbnail", "path", path, "error", err)
		h.respondError(w, "Invalid path: "+err.Error(), http.StatusBadRequest)
		return
	}
	if h.isProtectedRoot(fullPath) {
		h.respondError(w, "Cannot upload directly to a protected root", http.StatusBadRequest)
		return
	}
	if !tryAcquire(h.thumbnailGate) {
		respondBusy(w)
		return
	}
	defer release(h.thumbnailGate)
	source, err := h.openAllowedPath(fullPath, os.O_RDONLY, 0)
	if err != nil {
		h.respondError(w, "Cannot inspect video", http.StatusBadRequest)
		return
	}
	info, err := source.Stat()
	_ = source.Close()
	if err != nil || info.IsDir() {
		h.respondError(w, "Cannot inspect video", http.StatusBadRequest)
		return
	}

	// Include versioned file metadata so replacing a video cannot reuse stale art.
	hash := sha256.Sum256([]byte(fmt.Sprintf("%s:%d:%d", path, info.Size(), info.ModTime().UnixNano())))
	thumbnailFilename := hex.EncodeToString(hash[:]) + ".jpg"
	thumbnailPath := filepath.Join(thumbnailDir, thumbnailFilename)

	// check if thumbnail already exists
	if _, err := os.Stat(thumbnailPath); err == nil {
		http.ServeFile(w, r, thumbnailPath)
		return
	}

	// generate thumbnail
	resultChan := worker.SubmitWithResult(h.workerPool, func() interface{} {
		source, err := h.openAllowedPath(fullPath, os.O_RDONLY, 0)
		if err != nil {
			return err
		}
		defer func() { _ = source.Close() }()
		tmp, err := os.CreateTemp(thumbnailDir, ".thumbnail-*.jpg")
		if err != nil {
			return err
		}
		tmpPath := tmp.Name()
		if err := tmp.Close(); err != nil {
			return err
		}
		defer func() { _ = os.Remove(tmpPath) }()
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		videoPath, extraFiles := childProcessFilePath(source, fullPath)
		if err := h.generateThumbnail(ctx, videoPath, tmpPath, extraFiles...); err != nil {
			return err
		}
		if err := os.Rename(tmpPath, thumbnailPath); err != nil {
			return err
		}
		if err := h.cleanupThumbnailCacheIfDue(thumbnailDir, true); err != nil {
			h.logger.Warn("Failed to enforce thumbnail cache limit", "path", thumbnailDir, "error", err)
		}
		return nil
	})

	result := <-resultChan
	if err, ok := result.(error); ok && err != nil {
		h.logger.Error("Failed to generate thumbnail", "path", fullPath, "error", err)
		// respond with placeholder image or error
		h.respondError(w, "Cannot generate thumbnail", http.StatusInternalServerError)
		return
	}

	// serve the generated thumbnail
	http.ServeFile(w, r, thumbnailPath)
}

// ExtractFile - アーカイブファイルを解凍する
func (h *Handler) ExtractFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.logger.Error("Failed to decode request body", "error", err)
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		h.respondError(w, "Path required", http.StatusBadRequest)
		return
	}

	sourcePath, err := h.convertToPhysicalPath(req.Path)
	if err != nil {
		h.logger.Error("Invalid source path", "path", req.Path, "error", err)
		h.respondError(w, "Invalid source path: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 出力先ディレクトリを決定 (例: archive.zip -> archive/)
	destPath := strings.TrimSuffix(sourcePath, filepath.Ext(sourcePath))
	if h.isProtectedRoot(destPath) {
		h.respondError(w, "Cannot extract over a protected root", http.StatusBadRequest)
		return
	}
	if _, err := os.Lstat(destPath); err == nil {
		h.respondError(w, "Extraction destination already exists", http.StatusConflict)
		return
	} else if !os.IsNotExist(err) {
		h.respondError(w, "Cannot inspect extraction destination", http.StatusInternalServerError)
		return
	}
	if !tryAcquire(h.extractGate) {
		respondBusy(w)
		return
	}
	defer release(h.extractGate)

	// 並列処理で解凍
	resultChan := worker.SubmitWithResult(h.workerPool, func() interface{} {
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute) // 30分タイムアウト
		defer cancel()
		tempPath, err := os.MkdirTemp(filepath.Dir(destPath), ".puremania-extract-*")
		if err != nil {
			return fmt.Errorf("cannot create extraction staging directory: %w", err)
		}
		defer func() { _ = os.RemoveAll(tempPath) }()
		var extractedBytes int64
		var extractedFiles int
		maxBytes := h.config.MaxZipSize << 20

		source, err := os.Open(sourcePath)
		if err != nil {
			return fmt.Errorf("cannot open source file: %w", err)
		}
		defer func() {
			if err := source.Close(); err != nil {
				h.logger.Error("Failed to close source file", "path", sourcePath, "error", err)
			}
		}()

		format, stream, err := archives.Identify(ctx, sourcePath, source)
		if err != nil {
			return fmt.Errorf("could not identify archive format: %w", err)
		}

		handler := func(ctx context.Context, f archives.FileInfo) error {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			extractedFiles++
			if extractedFiles > 10000 {
				return fmt.Errorf("archive has too many files")
			}
			dest, err := secureJoin(tempPath, f.NameInArchive)
			if err != nil {
				return fmt.Errorf("unsafe file path in archive: %s", f.NameInArchive)
			}

			if f.IsDir() {
				return os.MkdirAll(dest, f.Mode())
			}

			if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
				return err
			}

			file, err := f.Open()
			if err != nil {
				return fmt.Errorf("could not open file in archive: %w", err)
			}
			defer func() {
				if err := file.Close(); err != nil {
					h.logger.Error("Failed to close file in archive", "path", f.NameInArchive, "error", err)
				}
			}()

			createdFile, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, f.Mode())
			if err != nil {
				return fmt.Errorf("could not create destination file: %w", err)
			}
			defer func() {
				if err := createdFile.Close(); err != nil {
					h.logger.Error("Failed to close destination file", "path", dest, "error", err)
				}
			}()

			written, err := io.Copy(createdFile, io.LimitReader(file, maxBytes-extractedBytes+1))
			extractedBytes += written
			if extractedBytes > maxBytes {
				return fmt.Errorf("archive exceeds extraction size limit")
			}
			return err
		}

		switch f := format.(type) {
		case archives.Zip:
			err = f.Extract(ctx, stream, handler)
		case archives.Tar:
			err = f.Extract(ctx, stream, handler)
		case archives.SevenZip:
			err = f.Extract(ctx, stream, handler)
		case archives.Rar:
			err = f.Extract(ctx, stream, handler)
		case archives.CompressedArchive:
			err = f.Extract(ctx, stream, handler)
		default:
			return fmt.Errorf("format %T is not a supported archive format for extraction", f)
		}

		if err != nil {
			return fmt.Errorf("extraction failed: %w", err)
		}
		if err := os.Rename(tempPath, destPath); err != nil {
			return fmt.Errorf("cannot publish extraction: %w", err)
		}
		return nil
	})

	result := <-resultChan
	if err, ok := result.(error); ok && err != nil {
		h.logger.Error("Failed to extract file", "path", req.Path, "error", err)
		h.respondError(w, "Cannot extract file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// キャッシュを無効化
	parentDir := filepath.Dir(sourcePath)
	cache.InvalidateByPrefix(h.cache, "list:"+h.convertToVirtualPath(parentDir))
	cache.InvalidateByPrefix(h.cache, "search:")

	h.respondSuccess(w, map[string]string{"message": "File extracted successfully"})
}

// Optimized buffer sizes for different operations
const (
	SmallBufferSize = 32 * 1024  // 32KB for small files
	LargeBufferSize = 64 * 1024  // 64KB for large files
	HugeBufferSize  = 128 * 1024 // 128KB for very large files
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

// ListFiles - TTLキャッシュ、ETagによる差分検知を使用
func (h *Handler) ListFiles(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-cache")
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/"
	}

	// 1. 現在のディレクトリ状態からETagを生成
	currentStateKey, err := h.generateDirectoryStateKey(path)
	if err != nil {
		h.logger.Error("Failed to generate directory state key", "path", path, "error", err)
		// ETag生成に失敗した場合は、キャッシュを使わずに通常処理
		h.serveFreshFileList(w, path, "") // ETagなしで提供
		return
	}
	if limit, parseErr := strconv.Atoi(r.URL.Query().Get("limit")); parseErr == nil && limit > 0 {
		h.servePaginatedFileList(w, r, path, currentStateKey, limit)
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
	if cached, found := cache.Get(h.cache, cacheKey); found {
		if fileInfos, ok := cached.([]types.FileInfo); ok {
			h.respondSuccess(w, fileInfos)
			return
		}
	}

	// 5. キャッシュがない場合は、新しいファイルリストを生成
	h.serveFreshFileList(w, path, currentStateKey)
}

type directoryPage struct {
	Data       []types.FileInfo `json:"data"`
	NextCursor string           `json:"nextCursor,omitempty"`
	HasMore    bool             `json:"hasMore"`
	Offset     int              `json:"offset"`
	Total      int              `json:"total"`
}

func (h *Handler) servePaginatedFileList(w http.ResponseWriter, r *http.Request, path, stateKey string, limit int) {
	if limit > 500 {
		limit = 500
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("cursor"))
	if offset < 0 {
		offset = 0
	}
	sortField := r.URL.Query().Get("sort")
	if sortField == "" {
		sortField = "name"
	}
	direction := r.URL.Query().Get("direction")
	if direction != "desc" {
		direction = "asc"
	}
	pageState := fmt.Sprintf("%s:%d:%d:%s:%s", stateKey, offset, limit, sortField, direction)
	pageHash := sha256.Sum256([]byte(pageState))
	etag := hex.EncodeToString(pageHash[:])
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("ETag", etag)

	cacheKey := "list:" + stateKey
	var files []types.FileInfo
	if cached, found := cache.Get(h.cache, cacheKey); found {
		files, _ = cached.([]types.FileInfo)
	}
	if files == nil {
		var err error
		files, err = h.getFileList(path)
		if err != nil {
			if os.IsNotExist(err) {
				h.respondError(w, "Directory not found", http.StatusNotFound)
			} else {
				h.respondError(w, "Cannot read directory", http.StatusInternalServerError)
			}
			return
		}
		cache.Set(h.cache, cacheKey, files, int64(len(files)*200), CacheTTL)
	}

	pageFiles := append([]types.FileInfo(nil), files...)
	sort.SliceStable(pageFiles, func(i, j int) bool {
		left, right := pageFiles[i], pageFiles[j]
		comparison := 0
		switch sortField {
		case "size":
			comparison = compareInt64(left.Size, right.Size)
		case "modified":
			comparison = strings.Compare(left.ModTime, right.ModTime)
		case "type":
			comparison = strings.Compare(fileSortType(left), fileSortType(right))
		default:
			comparison = strings.Compare(strings.ToLower(left.Name), strings.ToLower(right.Name))
		}
		if comparison == 0 {
			comparison = strings.Compare(left.Path, right.Path)
		}
		if direction == "desc" {
			return comparison > 0
		}
		return comparison < 0
	})
	if offset > len(pageFiles) {
		offset = len(pageFiles)
	}
	end := min(offset+limit, len(pageFiles))
	hasMore := end < len(pageFiles)
	nextCursor := ""
	if hasMore {
		nextCursor = strconv.Itoa(end)
	}
	h.respondSuccess(w, directoryPage{Data: pageFiles[offset:end], NextCursor: nextCursor, HasMore: hasMore, Offset: offset, Total: len(pageFiles)})
}

func compareInt64(left, right int64) int {
	if left < right {
		return -1
	}
	if left > right {
		return 1
	}
	return 0
}

func fileSortType(file types.FileInfo) string {
	if file.IsDir {
		return "dir"
	}
	return file.MimeType
}

// serveFreshFileList は新しいファイルリストを生成し、必要に応じてキャッシュに保存する
func (h *Handler) serveFreshFileList(w http.ResponseWriter, path string, etag string) {
	fileInfos, err := h.getFileList(path)
	if err != nil {
		if os.IsNotExist(err) {
			h.logger.Warn("Directory not found for listing", "path", path, "error", err)
			h.respondError(w, "Directory not found", http.StatusNotFound)
		} else {
			h.logger.Error("Failed to get file list", "path", path, "error", err)
			h.respondError(w, "Cannot read directory", http.StatusInternalServerError)
		}
		return
	}

	// 結果をキャッシュ（ETagがあれば）
	if etag != "" {
		cacheKey := "list:" + etag
		// size of fileInfos is roughly len(fileInfos) * 200 bytes
		cache.Set(h.cache, cacheKey, fileInfos, int64(len(fileInfos)*200), CacheTTL)
	}

	h.respondSuccess(w, fileInfos)
}

func (h *Handler) getFileList(path string) ([]types.FileInfo, error) {
	var fileInfos []types.FileInfo

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
				fileInfos = append(fileInfos, types.FileInfo{
					Name:    filepath.Base(mountDir),
					Path:    virtualPath,
					Size:    info.Size(),
					ModTime: info.ModTime().Format(time.RFC3339),
					IsDir:   true,
					IsMount: true,
				})
			} else if !os.IsNotExist(err) {
				h.logger.Warn("Failed to stat mount directory", "path", mountDir, "error", err)
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

func (h *Handler) processDirectoryEntries(entries []os.DirEntry, basePath string) []types.FileInfo {
	var fileInfos []types.FileInfo
	var mu sync.Mutex
	var wg sync.WaitGroup

	// 並列処理でエントリーを処理
	for _, entry := range entries {
		// Resumable-upload parts and metadata are internal implementation data,
		// never files the browser should present as user content.
		if filepath.Clean(basePath) == filepath.Clean(h.config.StorageDir) && entry.Name() == resumableUploadDir {
			continue
		}
		wg.Add(1)
		worker.Submit(h.workerPool, func() {
			defer wg.Done()

			var size int64
			var modTime time.Time

			if entry.Type().IsRegular() || entry.IsDir() {
				if info, err := entry.Info(); err == nil {
					size = info.Size()
					modTime = info.ModTime()
				}
			}

			var mimeType string
			isEditable := false

			if !entry.IsDir() {
				mimeType = mediaTypeByPath(entry.Name())
				isEditable = utils.IsTextFile(mimeType) || utils.IsEditableByExtension(entry.Name())
			} else {
				mimeType = "application/octet-stream"
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

			fileInfo := types.FileInfo{
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

	// Compatibility endpoint: spool multipart file parts to disk after a tiny
	// form-field buffer instead of allocating up to MAX_FILE_SIZE_MB per request.
	// New clients use resumable uploads and avoid multipart altogether.
	r.Body = http.MaxBytesReader(w, r.Body, h.config.MaxFileSize<<20)
	if err := r.ParseMultipartForm(64 << 10); err != nil {
		if r.MultipartForm != nil {
			_ = r.MultipartForm.RemoveAll()
		}
		h.logger.Error("Failed to parse multipart form", "error", err)
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
		h.logger.Error("Invalid path for upload", "path", path, "error", err)
		h.respondError(w, "Invalid path: "+err.Error(), http.StatusBadRequest)
		return
	}

	if err := os.MkdirAll(fullPath, 0755); err != nil {
		h.logger.Error("Failed to create upload directory", "path", fullPath, "error", err)
		h.respondError(w, "Cannot create directory", http.StatusInternalServerError)
		return
	}

	files := r.MultipartForm.File["file"]
	relativePaths := r.MultipartForm.Value["relativePath[]"]

	if len(files) != len(relativePaths) {
		h.logger.Warn("Mismatch between files and relative paths", "files_count", len(files), "paths_count", len(relativePaths))
		h.respondError(w, "Mismatch between files and relative paths", http.StatusBadRequest)
		return
	}

	// 並列アップロード処理
	resultChan := make(chan types.UploadResult, len(files))
	var wg sync.WaitGroup

	for i, fileHeader := range files {
		wg.Add(1)
		index := i
		worker.Submit(h.workerPool, func() {
			defer wg.Done()

			file, err := fileHeader.Open()
			if err != nil {
				h.logger.Error("Failed to open multipart file", "filename", fileHeader.Filename, "error", err)
				resultChan <- types.UploadResult{Path: fileHeader.Filename, Success: false}
				return
			}
			defer func() {
				if err := file.Close(); err != nil {
					h.logger.Error("Failed to close multipart file", "filename", fileHeader.Filename, "error", err)
				}
			}()

			relativePath := relativePaths[index]
			normalizedRelativePath := filepath.FromSlash(relativePath)
			targetPath, err := secureJoin(fullPath, normalizedRelativePath)
			if err != nil {
				h.logger.Warn("Rejected unsafe upload relative path", "base", fullPath, "relative_path", relativePath, "error", err)
				resultChan <- types.UploadResult{Path: relativePath, Success: false}
				return
			}
			targetDir := filepath.Dir(targetPath)

			if err := os.MkdirAll(targetDir, 0755); err != nil {
				h.logger.Error("Failed to create target directory for upload", "path", targetDir, "error", err)
				resultChan <- types.UploadResult{Path: relativePath, Success: false}
				return
			}

			if h.isProtectedRoot(targetPath) {
				resultChan <- types.UploadResult{Path: relativePath, Success: false}
				return
			}
			// Write to a sibling first so an interrupted legacy upload cannot
			// truncate or remove an existing destination.
			dst, err := os.CreateTemp(targetDir, ".puremania-uploading-*")
			if err != nil {
				h.logger.Error("Failed to create destination file", "path", targetPath, "error", err)
				resultChan <- types.UploadResult{Path: relativePath, Success: false}
				return
			}
			tmpPath := dst.Name()

			// The legacy multipart endpoint is retained for compatibility, but it
			// must never materialize even a "small" file with io.ReadAll. The
			// resumable endpoint is used by the UI; this preserves the same bounded
			// memory property for older API consumers.
			_, saveErr := io.CopyBuffer(dst, file, make([]byte, getOptimalBufferSize(fileHeader.Size)))
			if saveErr == nil {
				saveErr = dst.Sync()
			}

			// エラーチェック
			if saveErr != nil {
				_ = dst.Close()
				h.logger.Error("Failed to save uploaded file", "path", targetPath, "error", saveErr)
				if err := os.Remove(tmpPath); err != nil {
					h.logger.Error("Failed to remove partially uploaded file", "path", targetPath, "error", err)
				}
				resultChan <- types.UploadResult{Path: relativePath, Success: false}
				return
			}
			if err := dst.Close(); err != nil {
				_ = os.Remove(tmpPath)
				resultChan <- types.UploadResult{Path: relativePath, Success: false}
				return
			}
			if err := os.Rename(tmpPath, targetPath); err != nil {
				_ = os.Remove(tmpPath)
				resultChan <- types.UploadResult{Path: relativePath, Success: false}
				return
			}
			virtualPath := h.convertToVirtualPath(targetPath)
			resultChan <- types.UploadResult{Path: virtualPath, Success: true}

			// キャッシュクリア
			cache.InvalidateByPrefix(h.cache, "list:"+filepath.Dir(h.convertToVirtualPath(targetDir)))
			cache.InvalidateByPrefix(h.cache, "search:")
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
		if result.Success {
			uploadedFiles = append(uploadedFiles, result.Path)
		} else {
			failedFiles = append(failedFiles, result.Path)
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

// DownloadFile - http.ServeContentを使用してsendfile最適化
func (h *Handler) DownloadFile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		h.respondError(w, "Path required", http.StatusBadRequest)
		return
	}

	fullPath, err := h.convertToPhysicalPath(path)
	if err != nil {
		h.logger.Error("Invalid path for download", "path", path, "error", err)
		h.respondError(w, "Invalid path: "+err.Error(), http.StatusBadRequest)
		return
	}

	file, err := h.openAllowedPath(fullPath, os.O_RDONLY, 0)
	if err != nil {
		h.logger.Warn("Cannot open file for download", "path", fullPath, "error", err)
		h.respondError(w, "Cannot open file", http.StatusNotFound)
		return
	}
	defer func() {
		if err := file.Close(); err != nil {
			h.logger.Error("Failed to close file for download", "path", fullPath, "error", err)
		}
	}()

	stat, err := file.Stat()
	if err != nil {
		h.logger.Error("Cannot get file info for download", "path", fullPath, "error", err)
		h.respondError(w, "Cannot get file info", http.StatusInternalServerError)
		return
	}

	if stat.IsDir() {
		h.logger.Warn("Attempted to download a directory", "path", fullPath)
		h.respondError(w, "Cannot download directory", http.StatusBadRequest)
		return
	}

	contentType := mediaTypeByPath(path)

	filename := filepath.Base(path)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", contentDisposition(filename))

	// http.ServeContentを使用してsendfile最適化とRange/If-Modified-Since自動処理
	http.ServeContent(w, r, filename, stat.ModTime(), file)
}

func contentDisposition(filename string) string {
	if formatted := mime.FormatMediaType("inline", map[string]string{"filename": filename}); formatted != "" {
		return formatted
	}
	return `inline; filename="download"`
}

// GetFileContent - 画像はhttp.ServeFileで最適化、テキストはキャッシュ使用
func (h *Handler) GetFileContent(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "private, no-cache")
	path := r.URL.Query().Get("path")
	if path == "" {
		h.respondError(w, "Path required", http.StatusBadRequest)
		return
	}

	fullPath, err := h.convertToPhysicalPath(path)
	if err != nil {
		h.logger.Error("Invalid path for getting content", "path", path, "error", err)
		h.respondError(w, "Invalid path: "+err.Error(), http.StatusBadRequest)
		return
	}

	file, err := h.openAllowedPath(fullPath, os.O_RDONLY, 0)
	if err != nil {
		h.logger.Warn("Cannot get file info for content", "path", fullPath, "error", err)
		h.respondError(w, "Cannot get file info", http.StatusNotFound)
		return
	}
	defer func() { _ = file.Close() }()
	stat, err := file.Stat()
	if err != nil {
		h.logger.Warn("Cannot get file info for content", "path", fullPath, "error", err)
		h.respondError(w, "Cannot get file info", http.StatusNotFound)
		return
	}

	if stat.IsDir() {
		h.logger.Warn("Attempted to get content of a directory", "path", fullPath)
		h.respondError(w, "Cannot get content of directory", http.StatusBadRequest)
		return
	}

	mimeType := mediaTypeByPath(path)

	// 画像ファイルの場合はhttp.ServeFileで最適化
	if mimeType != "" && strings.HasPrefix(mimeType, "image/") {
		w.Header().Set("Cache-Control", "max-age=3600")
		http.ServeContent(w, r, filepath.Base(path), stat.ModTime(), file)
		return
	}

	if stat.Size() > 10*1024*1024 { // 10MB limit
		h.logger.Warn("File too large for editing", "path", fullPath, "size", stat.Size())
		h.respondError(w, "File too large for editing (max 10MB)", http.StatusBadRequest)
		return
	}

	// キャッシュチェック
	cacheKey := "content:" + path + ":" + strconv.FormatInt(stat.ModTime().Unix(), 10)
	if cached, found := cache.Get(h.cache, cacheKey); found {
		if content, ok := cached.(string); ok {
			h.respondSuccess(w, map[string]string{
				"content": content,
				"path":    path,
			})
			return
		}
	}

	// 並列処理でファイル読み込み
	resultChan := worker.SubmitWithResult(h.workerPool, func() interface{} {
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return err
		}
		content, err := io.ReadAll(file)
		if err != nil {
			h.logger.Error("Failed to read file content", "path", fullPath, "error", err)
			return nil
		}
		return string(content)
	})

	result := <-resultChan
	if contentStr, ok := result.(string); ok {
		// コンテンツをキャッシュ（TTL付き）
		cache.Set(h.cache, cacheKey, contentStr, stat.Size(), CacheTTL)

		h.respondSuccess(w, map[string]string{
			"content": contentStr,
			"path":    path,
		})
	} else {
		h.respondError(w, "Cannot read file", http.StatusInternalServerError)
	}
}

// DownloadZip prepares a validated archive before returning a normal download URL.
func (h *Handler) DownloadZip(w http.ResponseWriter, r *http.Request) {
	var req types.BatchPathsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.logger.Error("Failed to decode request body for zip download", "error", err)
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if err := validateBatchPaths(req.Paths); err != nil {
		h.respondError(w, err.Error(), http.StatusBadRequest)
		return
	}
	if !tryAcquire(h.zipGate) {
		respondBusy(w)
		return
	}
	defer release(h.zipGate)

	tmp, err := os.CreateTemp("", "puremania-download-*.zip")
	if err != nil {
		h.respondError(w, "Cannot prepare archive", http.StatusInternalServerError)
		return
	}
	tmpPath := tmp.Name()
	removeTemp := true
	defer func() {
		if closeErr := tmp.Close(); closeErr != nil {
			h.logger.Warn("Failed to close prepared zip", "error", closeErr)
		}
		if removeTemp {
			_ = os.Remove(tmpPath)
		}
	}()

	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(h.config.ZipTimeout)*time.Second)
	defer cancel()
	if err := h.createZipArchive(ctx, tmp, req.Paths); err != nil {
		h.logger.Error("Failed to prepare zip", "error", err)
		h.respondError(w, "Cannot create archive", http.StatusInternalServerError)
		return
	}
	if err := tmp.Sync(); err != nil {
		h.respondError(w, "Cannot finalize archive", http.StatusInternalServerError)
		return
	}

	tokenBytes := make([]byte, 24)
	if _, err := rand.Read(tokenBytes); err != nil {
		h.respondError(w, "Cannot create download token", http.StatusInternalServerError)
		return
	}
	token := hex.EncodeToString(tokenBytes)
	expiresAt := time.Now().Add(time.Hour)
	h.zipDownloads.Store(token, preparedZip{path: tmpPath, expiresAt: expiresAt})
	removeTemp = false
	time.AfterFunc(time.Until(expiresAt), func() {
		if value, loaded := h.zipDownloads.LoadAndDelete(token); loaded {
			_ = os.Remove(value.(preparedZip).path)
		}
	})
	h.respondSuccess(w, map[string]string{"downloadUrl": "/api/files/download-zip/" + token})
}

func (h *Handler) DownloadPreparedZip(w http.ResponseWriter, r *http.Request) {
	token := mux.Vars(r)["token"]
	// A prepared archive is a one-time capability. Consume the token before
	// opening the file so concurrent requests cannot replay the same archive.
	value, ok := h.zipDownloads.LoadAndDelete(token)
	if !ok {
		h.respondError(w, "Download not found or expired", http.StatusNotFound)
		return
	}
	prepared := value.(preparedZip)
	defer func() { _ = os.Remove(prepared.path) }()
	if time.Now().After(prepared.expiresAt) {
		h.respondError(w, "Download expired", http.StatusGone)
		return
	}
	file, err := os.Open(prepared.path)
	if err != nil {
		h.respondError(w, "Cannot open archive", http.StatusInternalServerError)
		return
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil {
		h.respondError(w, "Cannot inspect archive", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=\"files.zip\"")
	w.Header().Set("Cache-Control", "private, no-store")
	http.ServeContent(w, r, "files.zip", info.ModTime(), file)
}

type maxBytesWriter struct {
	w         io.Writer
	remaining int64
}

func (w *maxBytesWriter) Write(p []byte) (int, error) {
	if int64(len(p)) > w.remaining {
		return 0, fmt.Errorf("zip output exceeds configured size limit")
	}
	n, err := w.w.Write(p)
	w.remaining -= int64(n)
	return n, err
}

func (h *Handler) createZipArchive(ctx context.Context, w io.Writer, paths []string) error {
	zipWriter := zip.NewWriter(&maxBytesWriter{w: w, remaining: h.config.MaxZipSize << 20})

	var successfulFiles, failedFiles int64
	var inputBytes int64
	var mu sync.Mutex
	var wg sync.WaitGroup

	// 並列処理でファイルをZIPに追加
	for _, userPath := range paths {
		if err := ctx.Err(); err != nil {
			return err
		}
		wg.Add(1)
		func() {
			defer wg.Done()

			fullPath, err := h.convertToPhysicalPath(userPath)
			if err != nil {
				h.logger.Error("Invalid path for zipping", "path", userPath, "error", err)
				atomic.AddInt64(&failedFiles, 1)
				return
			}

			file, err := h.openAllowedPath(fullPath, os.O_RDONLY, 0)
			if err != nil {
				h.logger.Error("Failed to stat file for zipping", "path", fullPath, "error", err)
				atomic.AddInt64(&failedFiles, 1)
				return
			}
			fileInfo, err := file.Stat()
			_ = file.Close()
			if err != nil {
				h.logger.Error("Failed to stat file for zipping", "path", fullPath, "error", err)
				atomic.AddInt64(&failedFiles, 1)
				return
			}

			if fileInfo.IsDir() {
				// ディレクトリの場合は並列WalkDir
				h.addDirectoryToZip(ctx, zipWriter, fullPath, &successfulFiles, &failedFiles, &mu)
			} else {
				inputBytes += fileInfo.Size()
				if inputBytes > h.config.MaxZipSize<<20 {
					atomic.AddInt64(&failedFiles, 1)
					return
				}
				// 単一ファイルの処理
				if h.addFileToZip(ctx, zipWriter, fullPath, filepath.Base(userPath), &mu) {
					atomic.AddInt64(&successfulFiles, 1)
				} else {
					atomic.AddInt64(&failedFiles, 1)
				}
			}
		}()
	}

	wg.Wait()
	if failedFiles > 0 {
		return fmt.Errorf("failed to add %d file(s) to zip", failedFiles)
	}
	if err := zipWriter.Close(); err != nil {
		return err
	}
	return nil
}

func (h *Handler) addDirectoryToZip(ctx context.Context, zipWriter *zip.Writer, dirPath string, successfulFiles, failedFiles *int64, mu *sync.Mutex) {
	var wg sync.WaitGroup

	err := filepath.WalkDir(dirPath, func(filePath string, d os.DirEntry, err error) error {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return ctxErr
		}
		if err != nil {
			h.logger.Error("Error during directory walk for zipping", "path", filePath, "error", err)
			return err
		}

		relPath, err := filepath.Rel(filepath.Dir(dirPath), filePath)
		if err != nil {
			h.logger.Error("Failed to get relative path for zipping", "path", filePath, "error", err)
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
			} else {
				h.logger.Warn("Failed to get dir info for zip header", "path", filePath, "error", err)
			}

			mu.Lock()
			_, err = zipWriter.CreateHeader(header)
			mu.Unlock()
			if err != nil {
				h.logger.Error("Failed to create zip header for directory", "path", relPath, "error", err)
				return err // エラーを返してWalkを停止
			}
			return nil
		}

		// zip.Writer must be written serially; addFileToZip already holds mu.
		if h.addFileToZip(ctx, zipWriter, filePath, relPath, mu) {
			atomic.AddInt64(successfulFiles, 1)
		} else {
			atomic.AddInt64(failedFiles, 1)
		}

		return nil
	})

	if err != nil {
		h.logger.Error("Failed to walk directory for zipping", "path", dirPath, "error", err)
	}

	wg.Wait()
}

func (h *Handler) addFileToZip(ctx context.Context, zipWriter *zip.Writer, filePath, zipPath string, mu *sync.Mutex) bool {
	if ctx.Err() != nil {
		return false
	}
	file, err := h.openAllowedPath(filePath, os.O_RDONLY, 0)
	if err != nil {
		h.logger.Error("Failed to stat file for zipping", "path", filePath, "error", err)
		return false
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		h.logger.Error("Failed to stat file for zipping", "path", filePath, "error", err)
		return false
	}

	header, err := zip.FileInfoHeader(info)
	if err != nil {
		h.logger.Error("Failed to create zip file info header", "path", filePath, "error", err)
		return false
	}

	header.Name = filepath.ToSlash(zipPath)
	header.Method = zip.Deflate

	defer func() {
		if err := file.Close(); err != nil {
			h.logger.Error("Failed to close file for zipping", "path", filePath, "error", err)
		}
	}()

	mu.Lock()
	defer mu.Unlock()

	writer, err := zipWriter.CreateHeader(header)
	if err != nil {
		h.logger.Error("Failed to create zip header for file", "path", zipPath, "error", err)
		return false
	}

	// バッファサイズ最適化
	bufferSize := getOptimalBufferSize(info.Size())
	buffer := make([]byte, bufferSize)

	_, err = io.CopyBuffer(writer, contextReader{ctx: ctx, reader: file}, buffer)
	if err != nil {
		h.logger.Error("Failed to copy file content to zip", "path", filePath, "error", err)
	}

	return err == nil
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	select {
	case <-r.ctx.Done():
		return 0, r.ctx.Err()
	default:
		return r.reader.Read(p)
	}
}

func (h *Handler) SaveFile(w http.ResponseWriter, r *http.Request) {
	var req types.SaveFileRequest
	r.Body = http.MaxBytesReader(w, r.Body, 11<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		h.logger.Error("Failed to decode request body for saving file", "error", err)
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if req.Path == "" {
		h.respondError(w, "Path required", http.StatusBadRequest)
		return
	}

	fullPath, err := h.convertToPhysicalPath(req.Path)
	if err != nil {
		h.logger.Error("Invalid path for saving file", "path", req.Path, "error", err)
		h.respondError(w, "Invalid path: "+err.Error(), http.StatusBadRequest)
		return
	}
	if h.isProtectedRoot(fullPath) {
		h.respondError(w, "Cannot overwrite a protected root", http.StatusBadRequest)
		return
	}

	// 並列処理でファイル保存
	resultChan := worker.SubmitWithResult(h.workerPool, func() interface{} {
		err := atomicWriteFile(fullPath, []byte(req.Content), 0644)
		return err
	})

	result := <-resultChan
	if err, ok := result.(error); ok && err != nil {
		h.logger.Error("Failed to save file", "path", fullPath, "error", err)
		h.respondError(w, "Cannot save file", http.StatusInternalServerError)
		return
	}

	// キャッシュを無効化
	h.invalidateFileCache(fullPath)
	cache.InvalidateByPrefix(h.cache, "search:")

	h.respondSuccess(w, map[string]string{"message": "File saved successfully"})
}

func (h *Handler) DeleteMultipleFiles(w http.ResponseWriter, r *http.Request) {
	var req types.BatchPathsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.logger.Error("Failed to decode request body for deleting files", "error", err)
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if err := validateBatchPaths(req.Paths); err != nil {
		h.respondError(w, err.Error(), http.StatusBadRequest)
		return
	}

	// 並列処理で削除
	var errors []string
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, path := range req.Paths {
		wg.Add(1)
		worker.Submit(h.workerPool, func() {
			defer wg.Done()

			fullPath, err := h.convertToPhysicalPath(path)
			if err != nil {
				h.logger.Error("Invalid path for deletion", "path", path, "error", err)
				mu.Lock()
				errors = append(errors, fmt.Sprintf("Invalid path %s: %v", path, err))
				mu.Unlock()
				return
			}
			if h.isProtectedRoot(fullPath) {
				mu.Lock()
				errors = append(errors, fmt.Sprintf("Cannot delete protected root %s", path))
				mu.Unlock()
				return
			}

			err = os.RemoveAll(fullPath)
			if err != nil {
				h.logger.Error("Failed to delete item", "path", fullPath, "error", err)
				mu.Lock()
				errors = append(errors, fmt.Sprintf("Cannot delete %s: %v", path, err))
				mu.Unlock()
			} else {
				// キャッシュを無効化
				h.invalidateFileCache(fullPath)
				cache.InvalidateByPrefix(h.cache, "list:"+filepath.Dir(h.convertToVirtualPath(fullPath)))
				cache.InvalidateByPrefix(h.cache, "search:")
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
	var req types.CreateDirectoryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.logger.Error("Failed to decode request body for creating directory", "error", err)
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if len(req.Path) > maxVirtualPathBytes || len(req.Name) > maxRelativePathBytes {
		h.respondError(w, "Path or name is too long", http.StatusBadRequest)
		return
	}

	parentPath, err := h.convertToPhysicalPath(req.Path)
	if err != nil {
		h.logger.Error("Invalid base path for creating directory", "path", req.Path, "error", err)
		h.respondError(w, "Invalid base path: "+err.Error(), http.StatusBadRequest)
		return
	}

	if strings.Contains(req.Name, "..") {
		h.respondError(w, "Invalid directory name", http.StatusBadRequest)
		return
	}
	newDirPath, err := secureJoin(parentPath, req.Name)
	if err != nil {
		h.respondError(w, "Invalid directory name", http.StatusBadRequest)
		return
	}

	// 並列処理でディレクトリ作成
	resultChan := worker.SubmitWithResult(h.workerPool, func() interface{} {
		return os.MkdirAll(newDirPath, 0755)
	})

	result := <-resultChan
	if err, ok := result.(error); ok && err != nil {
		h.logger.Error("Failed to create directory", "path", newDirPath, "error", err)
		h.respondError(w, "Cannot create directory", http.StatusInternalServerError)
		return
	}

	// 親ディレクトリのキャッシュを無効化
	cache.InvalidateByPrefix(h.cache, "list:"+h.convertToVirtualPath(parentPath))
	cache.InvalidateByPrefix(h.cache, "search:")

	h.respondSuccess(w, map[string]string{"message": "Directory created successfully"})
}

// ファイル移動機能
func (h *Handler) MoveFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SourcePath string `json:"sourcePath"`
		TargetPath string `json:"targetPath"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.logger.Error("Failed to decode request body for moving file", "error", err)
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.SourcePath == "" || req.TargetPath == "" {
		h.respondError(w, "Source and target paths required", http.StatusBadRequest)
		return
	}
	if len(req.SourcePath) > maxVirtualPathBytes || len(req.TargetPath) > maxVirtualPathBytes {
		h.respondError(w, "Path is too long", http.StatusBadRequest)
		return
	}

	sourceFullPath, err := h.convertToPhysicalPath(req.SourcePath)
	if err != nil {
		h.logger.Error("Invalid source path for moving", "path", req.SourcePath, "error", err)
		h.respondError(w, "Invalid source path: "+err.Error(), http.StatusBadRequest)
		return
	}
	if h.isProtectedRoot(sourceFullPath) {
		h.respondError(w, "Cannot move a protected root", http.StatusBadRequest)
		return
	}

	targetFullPath, err := h.convertToPhysicalPath(req.TargetPath)
	if err != nil {
		h.logger.Error("Invalid target path for moving", "path", req.TargetPath, "error", err)
		h.respondError(w, "Invalid target path: "+err.Error(), http.StatusBadRequest)
		return
	}
	if h.isProtectedRoot(targetFullPath) {
		h.respondError(w, "Cannot overwrite a protected root", http.StatusBadRequest)
		return
	}

	// 並列処理でファイル移動
	resultChan := worker.SubmitWithResult(h.workerPool, func() interface{} {
		// ターゲットディレクトリが存在するか確認
		if _, err := os.Stat(filepath.Dir(targetFullPath)); os.IsNotExist(err) {
			return fmt.Errorf("target directory does not exist")
		}

		// ファイル移動
		return os.Rename(sourceFullPath, targetFullPath)
	})

	result := <-resultChan
	if err, ok := result.(error); ok && err != nil {
		h.logger.Error("Failed to move file", "source", sourceFullPath, "target", targetFullPath, "error", err)
		h.respondError(w, "Cannot move file: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// キャッシュを無効化
	h.invalidateFileCache(sourceFullPath)
	h.invalidateFileCache(targetFullPath)
	cache.InvalidateByPrefix(h.cache, "list:"+filepath.Dir(h.convertToVirtualPath(sourceFullPath)))
	cache.InvalidateByPrefix(h.cache, "list:"+filepath.Dir(h.convertToVirtualPath(targetFullPath)))
	cache.InvalidateByPrefix(h.cache, "search:")

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
		h.logger.Error("Failed to decode request body for creating file", "error", err)
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Path == "" || req.Name == "" {
		h.respondError(w, "Path and name required", http.StatusBadRequest)
		return
	}
	if len(req.Path) > maxVirtualPathBytes || len(req.Name) > maxRelativePathBytes {
		h.respondError(w, "Path or name is too long", http.StatusBadRequest)
		return
	}

	parentPath, err := h.convertToPhysicalPath(req.Path)
	if err != nil {
		h.logger.Error("Invalid path for creating file", "path", req.Path, "error", err)
		h.respondError(w, "Invalid path: "+err.Error(), http.StatusBadRequest)
		return
	}

	// デフォルトで.md拡張子を追加
	if !strings.Contains(req.Name, ".") {
		req.Name += ".md"
	}

	if strings.Contains(req.Name, "..") {
		h.respondError(w, "Invalid file name", http.StatusBadRequest)
		return
	}
	newFilePath, err := secureJoin(parentPath, req.Name)
	if err != nil {
		h.respondError(w, "Invalid file name", http.StatusBadRequest)
		return
	}
	if h.isProtectedRoot(newFilePath) {
		h.respondError(w, "Cannot overwrite a protected root", http.StatusBadRequest)
		return
	}

	// 並列処理でファイル作成
	resultChan := worker.SubmitWithResult(h.workerPool, func() interface{} {
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
			h.logger.Warn("Attempted to create a file that already exists", "path", newFilePath)
			h.respondError(w, "File already exists", http.StatusBadRequest)
		} else {
			h.logger.Error("Failed to create file", "path", newFilePath, "error", err)
			h.respondError(w, "Cannot create file", http.StatusInternalServerError)
		}
		return
	}

	// 親ディレクトリのキャッシュを無効化
	cache.InvalidateByPrefix(h.cache, "list:"+h.convertToVirtualPath(parentPath))
	cache.InvalidateByPrefix(h.cache, "search:")

	// 仮想パスを返す
	virtualPath := h.convertToVirtualPath(newFilePath)

	h.respondSuccess(w, map[string]string{
		"message": "File created successfully",
		"path":    virtualPath,
	})
}
