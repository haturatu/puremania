package handlers

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"puremania/cache"
	"puremania/types"
	"puremania/utils"
	"puremania/worker"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/mholt/archives"
)

// ExtractFile - アーカイブファイルを解凍する
func (h *Handler) ExtractFile(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Path string `json:"path"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Path == "" {
		h.respondError(w, "Path required", http.StatusBadRequest)
		return
	}

	sourcePath, err := h.convertToPhysicalPath(req.Path)
	if err != nil {
		h.respondError(w, "Invalid source path: "+err.Error(), http.StatusBadRequest)
		return
	}

	// 出力先ディレクトリを決定 (例: archive.zip -> archive/)
	destPath := strings.TrimSuffix(sourcePath, filepath.Ext(sourcePath))

	// 並列処理で解凍
	resultChan := worker.SubmitWithResult(h.workerPool, func() interface{} {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute) // 30分タイムアウト
		defer cancel()

		source, err := os.Open(sourcePath)
		if err != nil {
			return fmt.Errorf("cannot open source file: %w", err)
		}
		defer source.Close()

		format, stream, err := archives.Identify(ctx, sourcePath, source)
		if err != nil {
			return fmt.Errorf("could not identify archive format: %w", err)
		}

		handler := func(ctx context.Context, f archives.FileInfo) error {
			dest := filepath.Join(destPath, f.NameInArchive)
			if !strings.HasPrefix(dest, destPath) {
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
			defer file.Close()

			createdFile, err := os.Create(dest)
			if err != nil {
				return fmt.Errorf("could not create destination file: %w", err)
			}
			defer createdFile.Close()

			_, err = io.Copy(createdFile, file)
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
			os.RemoveAll(destPath)
			return fmt.Errorf("extraction failed: %w", err)
		}

		return nil
	})

	result := <-resultChan
	if err, ok := result.(error); ok && err != nil {
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
	SmallBufferSize = 32 * 1024       // 32KB for small files
	LargeBufferSize = 64 * 1024       // 64KB for large files
	HugeBufferSize  = 128 * 1024      // 128KB for very large files
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
	if cached, found := cache.Get(h.cache, cacheKey); found {
		if fileInfos, ok := cached.([]types.FileInfo); ok {
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
	resultChan := make(chan types.UploadResult, len(files))
	var wg sync.WaitGroup

	for i, fileHeader := range files {
		wg.Add(1)
		index := i
		worker.Submit(h.workerPool, func() {
			defer wg.Done()

			file, err := fileHeader.Open()
			if err != nil {
				resultChan <- types.UploadResult{Path: fileHeader.Filename, Success: false}
				return
			}
			defer file.Close()

			relativePath := relativePaths[index]
			normalizedRelativePath := filepath.FromSlash(relativePath)
			targetPath := filepath.Join(fullPath, normalizedRelativePath)
			targetDir := filepath.Dir(targetPath)

			if err := os.MkdirAll(targetDir, 0755); err != nil {
				resultChan <- types.UploadResult{Path: relativePath, Success: false}
				return
			}

			// ファイル作成
			dst, err := os.Create(targetPath)
			if err != nil {
				resultChan <- types.UploadResult{Path: relativePath, Success: false}
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
		content, err := os.ReadFile(fullPath)
		if err != nil {
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

// DownloadZip - 並列処理でZIPストリーミング配信
func (h *Handler) DownloadZip(w http.ResponseWriter, r *http.Request) {
	var req types.BatchPathsRequest
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
		worker.Submit(h.workerPool, func() {
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
		worker.Submit(h.workerPool, func() {
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
	var req types.SaveFileRequest
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
	resultChan := worker.SubmitWithResult(h.workerPool, func() interface{} {
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
	cache.InvalidateByPrefix(h.cache, "search:")

	h.respondSuccess(w, map[string]string{"message": "File saved successfully"})
}

func (h *Handler) DeleteMultipleFiles(w http.ResponseWriter, r *http.Request) {
	var req types.BatchPathsRequest
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
		worker.Submit(h.workerPool, func() {
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
	resultChan := worker.SubmitWithResult(h.workerPool, func() interface{} {
		return os.MkdirAll(newDirPath, 0755)
	})

	result := <-resultChan
	if err, ok := result.(error); ok && err != nil {
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
			h.respondError(w, "File already exists", http.StatusBadRequest)
		} else {
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
