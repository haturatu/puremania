package handlers

import (
	"archive/zip"
	"encoding/json"
	"puremania/config"
	"puremania/models"
	"puremania/utils"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"regexp"
	"syscall"
)

type Handler struct {
	config *config.Config
}

func NewHandler(config *config.Config) *Handler {
	return &Handler{config: config}
}

func (h *Handler) ListFiles(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/"
	}

	var fileInfos []models.FileInfo

	// 特別なディレクトリのマッピング
	specialDirs := map[string]string{
		"/documents": "Documents",
		"/images":    "Images",
		"/music":     "Music",
		"/videos":    "Videos",
		"/downloads": "Downloads",
	}

	// 特別なディレクトリへのアクセスを処理
	if dirName, exists := specialDirs[path]; exists {
		// 特別なディレクトリの場合はストレージディレクトリ内の対応するフォルダを表示
		fullPath := filepath.Join(h.config.StorageDir, dirName)
		
		// ディレクトリが存在する場合のみ読み込み
		if _, err := os.Stat(fullPath); err == nil {
			files, err := os.ReadDir(fullPath)
			if err != nil {
				h.respondError(w, "Cannot read directory", http.StatusInternalServerError)
				return
			}

			for _, file := range files {
				info, err := file.Info()
				if err != nil {
					continue
				}
				
				mimeType := "application/octet-stream"
				isEditable := false

				if !file.IsDir() {
					mimeType = mime.TypeByExtension(filepath.Ext(file.Name()))
					if mimeType == "" {
						mimeType = "application/octet-stream"
					}
					isEditable = utils.IsTextFile(mimeType) || utils.IsEditableByExtension(file.Name())
				}

				fileInfo := models.FileInfo{
					Name:       file.Name(),
					Path:       filepath.ToSlash(filepath.Join(path, file.Name())),
					Size:       info.Size(),
					ModTime:    info.ModTime().Format(time.RFC3339),
					IsDir:      file.IsDir(),
					MimeType:   mimeType,
					IsEditable: isEditable,
				}
				fileInfos = append(fileInfos, fileInfo)
			}
		}
		// ディレクトリが存在しない場合は空のリストを返す
		h.respondSuccess(w, fileInfos)
		return
	}

	// 通常のパス処理
	fullPath, err := utils.ResolveAndValidatePath(h.config, path)
	if err != nil {
		h.respondError(w, "Invalid path: "+err.Error(), http.StatusBadRequest)
		return
	}

	// ルートディレクトリの場合はマウントポイントも表示
	if path == "/" {
		// Add mount directories as special folders
		for _, mountDir := range h.config.MountDirs {
			info, err := os.Stat(mountDir)
			if err == nil {
				fileInfos = append(fileInfos, models.FileInfo{
					Name:    filepath.Base(mountDir),
					Path:    "/" + filepath.Base(mountDir),
					Size:    info.Size(),
					ModTime: info.ModTime().Format(time.RFC3339),
					IsDir:   true,
					IsMount: true,
				})
			}
		}
	}

	// ディレクトリのファイルを読み込み
	files, err := os.ReadDir(fullPath)
	if err != nil {
		// ディレクトリが存在しない場合や読み込みエラーの場合
		h.respondError(w, "Cannot read directory", http.StatusInternalServerError)
		return
	}

	for _, file := range files {
		info, err := file.Info()
		if err != nil {
			continue
		}
		
		mimeType := "application/octet-stream"
		isEditable := false

		if !file.IsDir() {
			mimeType = mime.TypeByExtension(filepath.Ext(file.Name()))
			if mimeType == "" {
				mimeType = "application/octet-stream"
			}
			isEditable = utils.IsTextFile(mimeType) || utils.IsEditableByExtension(file.Name())
		}

		fileInfo := models.FileInfo{
			Name:       file.Name(),
			Path:       filepath.ToSlash(filepath.Join(path, file.Name())),
			Size:       info.Size(),
			ModTime:    info.ModTime().Format(time.RFC3339),
			IsDir:      file.IsDir(),
			MimeType:   mimeType,
			IsEditable: isEditable,
		}
		fileInfos = append(fileInfos, fileInfo)
	}

	h.respondSuccess(w, fileInfos)
}

func (h *Handler) UploadFile(w http.ResponseWriter, r *http.Request) {
    if err := r.ParseMultipartForm(h.config.MaxFileSize << 20); err != nil {
        h.respondError(w, "File is too large", http.StatusBadRequest)
        return
    }

    path := r.FormValue("path")
    if path == "" {
        path = "/"
    }

    fullPath, err := utils.ResolveAndValidatePath(h.config, path)
    if err != nil {
        h.respondError(w, "Invalid path: "+err.Error(), http.StatusBadRequest)
        return
    }

    if err := os.MkdirAll(fullPath, 0755); err != nil {
        h.respondError(w, "Cannot create directory", http.StatusInternalServerError)
        return
    }

    // 複数ファイルの処理
    files := r.MultipartForm.File["file"]
    uploadedFiles := make([]string, 0)
    failedFiles := make([]string, 0)

    for _, fileHeader := range files {
        file, err := fileHeader.Open()
        if err != nil {
            failedFiles = append(failedFiles, fileHeader.Filename)
            continue
        }
        defer file.Close()

        filePath := filepath.Join(fullPath, fileHeader.Filename)
        dst, err := os.Create(filePath)
        if err != nil {
            failedFiles = append(failedFiles, fileHeader.Filename)
            continue
        }
        defer dst.Close()

        _, err = io.Copy(dst, file)
        if err != nil {
            failedFiles = append(failedFiles, fileHeader.Filename)
            continue
        }

        uploadedFiles = append(uploadedFiles, filepath.ToSlash(filepath.Join(path, fileHeader.Filename)))
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

func (h *Handler) DownloadFile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		h.respondError(w, "Path required", http.StatusBadRequest)
		return
	}

	fullPath, err := utils.ResolveAndValidatePath(h.config, path)
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
	w.Header().Set("Content-Type", contentType)

	// オーディオ/ビデオの場合はRangeリクエストを許可
	if strings.HasPrefix(contentType, "audio/") || strings.HasPrefix(contentType, "video/") {
		w.Header().Set("Accept-Ranges", "bytes")
	}

	filename := filepath.Base(path)
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=\"%s\"", filename))

	rangeHeader := r.Header.Get("Range")
	if rangeHeader == "" {
		w.Header().Set("Content-Length", strconv.FormatInt(stat.Size(), 10))
		io.Copy(w, file)
		return
	}

	var start, end int64
	if strings.HasPrefix(rangeHeader, "bytes=") {
		rangeStr := rangeHeader[6:]
		ranges := strings.Split(rangeStr, "-")
		if len(ranges) == 2 {
			start, _ = strconv.ParseInt(ranges[0], 10, 64)
			if ranges[1] != "" {
				end, _ = strconv.ParseInt(ranges[1], 10, 64)
			} else {
				end = stat.Size() - 1
			}
		}
	}

	if end >= stat.Size() {
		end = stat.Size() - 1
	}
	contentLength := end - start + 1

	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, stat.Size()))
	w.Header().Set("Content-Length", strconv.FormatInt(contentLength, 10))
	w.WriteHeader(http.StatusPartialContent)

	file.Seek(start, 0)
	io.CopyN(w, file, contentLength)
}

func (h *Handler) GetFileContent(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		h.respondError(w, "Path required", http.StatusBadRequest)
		return
	}

	fullPath, err := utils.ResolveAndValidatePath(h.config, path)
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

	// 画像ファイルの場合は直接サーブ
	mimeType := mime.TypeByExtension(filepath.Ext(path))
	if mimeType != "" && strings.HasPrefix(mimeType, "image/") {
		file, err := os.Open(fullPath)
		if err != nil {
			h.respondError(w, "Cannot open file", http.StatusNotFound)
			return
		}
		defer file.Close()

		w.Header().Set("Content-Type", mimeType)
		w.Header().Set("Cache-Control", "max-age=3600")
		io.Copy(w, file)
		return
	}

	if stat.Size() > 10*1024*1024 { // 10MB limit
		h.respondError(w, "File too large for editing (max 10MB)", http.StatusBadRequest)
		return
	}

	content, err := os.ReadFile(fullPath)
	if err != nil {
		h.respondError(w, "Cannot read file", http.StatusInternalServerError)
		return
	}

	h.respondSuccess(w, map[string]string{
		"content": string(content),
		"path":    path,
	})
}

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

	zipWriter := zip.NewWriter(w)
	defer zipWriter.Close()

	successfulFiles := 0
	failedFiles := 0

	for _, userPath := range req.Paths {
		fullPath, err := utils.ResolveAndValidatePath(h.config, userPath)
		if err != nil {
			fmt.Printf("Skipping invalid path for zipping: %s (%v)\n", userPath, err)
			failedFiles++
			continue
		}

		fileInfo, err := os.Stat(fullPath)
		if err != nil {
			fmt.Printf("Cannot stat file: %s (%v)\n", userPath, err)
			failedFiles++
			continue
		}

		if fileInfo.IsDir() {
			// ディレクトリの処理
			err = filepath.Walk(fullPath, func(filePath string, info os.FileInfo, err error) error {
				if err != nil {
					return err
				}

				relPath, err := filepath.Rel(filepath.Dir(fullPath), filePath)
				if err != nil {
					return err
				}

				if fullPath == filePath {
					relPath = filepath.Base(fullPath)
				} else {
					relPath = filepath.Join(filepath.Base(fullPath), relPath)
				}

				header, err := zip.FileInfoHeader(info)
				if err != nil {
					return err
				}

				header.Name = filepath.ToSlash(relPath)
				header.Method = zip.Deflate

				writer, err := zipWriter.CreateHeader(header)
				if err != nil {
					return err
				}

				if !info.IsDir() {
					file, err := os.Open(filePath)
					if err != nil {
						return err
					}
					defer file.Close()

					buffer := make([]byte, 32*1024)
					_, err = io.CopyBuffer(writer, file, buffer)
					if err != nil {
						return err
					}
					successfulFiles++
				}
				return nil
			})

			if err != nil {
				fmt.Printf("Error during zipping path %s: %v\n", userPath, err)
				failedFiles++
			}
		} else {
			// 単一ファイルの処理
			header, err := zip.FileInfoHeader(fileInfo)
			if err != nil {
				failedFiles++
				continue
			}

			header.Name = filepath.Base(userPath)
			header.Method = zip.Deflate

			writer, err := zipWriter.CreateHeader(header)
			if err != nil {
				failedFiles++
				continue
			}

			file, err := os.Open(fullPath)
			if err != nil {
				failedFiles++
				continue
			}
			defer file.Close()

			buffer := make([]byte, 32*1024)
			_, err = io.CopyBuffer(writer, file, buffer)
			if err != nil {
				failedFiles++
				continue
			}
			successfulFiles++
		}
	}

	// レスポンスに統計情報を含める
	w.Header().Set("X-Zip-Successful-Files", strconv.Itoa(successfulFiles))
	w.Header().Set("X-Zip-Failed-Files", strconv.Itoa(failedFiles))
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

	fullPath, err := utils.ResolveAndValidatePath(h.config, req.Path)
	if err != nil {
		h.respondError(w, "Invalid path: "+err.Error(), http.StatusBadRequest)
		return
	}

	err = os.WriteFile(fullPath, []byte(req.Content), 0644)
	if err != nil {
		h.respondError(w, "Cannot save file", http.StatusInternalServerError)
		return
	}

	h.respondSuccess(w, map[string]string{"message": "File saved successfully"})
}

func (h *Handler) DeleteMultipleFiles(w http.ResponseWriter, r *http.Request) {
	var req models.BatchPathsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	var errors []string
	for _, path := range req.Paths {
		fullPath, err := utils.ResolveAndValidatePath(h.config, path)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Invalid path %s: %v", path, err))
			continue
		}

		err = os.RemoveAll(fullPath)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Cannot delete %s: %v", path, err))
		}
	}

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

	parentPath, err := utils.ResolveAndValidatePath(h.config, req.Path)
	if err != nil {
		h.respondError(w, "Invalid base path: "+err.Error(), http.StatusBadRequest)
		return
	}
	
	newDirPath := filepath.Join(parentPath, req.Name)
	if strings.Contains(req.Name, "..") {
		h.respondError(w, "Invalid directory name", http.StatusBadRequest)
		return
	}

	err = os.MkdirAll(newDirPath, 0755)
	if err != nil {
		h.respondError(w, "Cannot create directory", http.StatusInternalServerError)
		return
	}

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

	sourceFullPath, err := utils.ResolveAndValidatePath(h.config, req.SourcePath)
	if err != nil {
		h.respondError(w, "Invalid source path: "+err.Error(), http.StatusBadRequest)
		return
	}

	targetFullPath, err := utils.ResolveAndValidatePath(h.config, req.TargetPath)
	if err != nil {
		h.respondError(w, "Invalid target path: "+err.Error(), http.StatusBadRequest)
		return
	}

	// ターゲットディレクトリが存在するか確認
	if _, err := os.Stat(filepath.Dir(targetFullPath)); os.IsNotExist(err) {
		h.respondError(w, "Target directory does not exist", http.StatusBadRequest)
		return
	}

	// ファイル移動
	err = os.Rename(sourceFullPath, targetFullPath)
	if err != nil {
		h.respondError(w, "Cannot move file: "+err.Error(), http.StatusInternalServerError)
		return
	}

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

	parentPath, err := utils.ResolveAndValidatePath(h.config, req.Path)
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

	// ファイルが既に存在するか確認
	if _, err := os.Stat(newFilePath); err == nil {
		h.respondError(w, "File already exists", http.StatusBadRequest)
		return
	}

	// デフォルトコンテンツ
	content := req.Content
	if content == "" {
		content = "# " + strings.TrimSuffix(req.Name, filepath.Ext(req.Name)) + "\n\n"
	}

	err = os.WriteFile(newFilePath, []byte(content), 0644)
	if err != nil {
		h.respondError(w, "Cannot create file", http.StatusInternalServerError)
		return
	}

	h.respondSuccess(w, map[string]string{
		"message": "File created successfully",
		"path":    filepath.ToSlash(filepath.Join(req.Path, req.Name)),
	})
}

func (h *Handler) GetConfig(w http.ResponseWriter, r *http.Request) {
	h.respondSuccess(w, h.config)
}

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

	basePath, err := utils.ResolveAndValidatePath(h.config, req.Path)
	if err != nil {
		h.respondError(w, "Invalid path", http.StatusBadRequest)
		return
	}

	var results []models.FileInfo
	var searchFunc func(string) bool

	if req.UseRegex {
		var regex *regexp.Regexp
		if req.CaseSensitive {
			regex, err = regexp.Compile(req.Term)
		} else {
			regex, err = regexp.Compile("(?i)" + req.Term)
		}
		if err != nil {
			h.respondError(w, "Invalid regex pattern", http.StatusBadRequest)
			return
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
		results = h.searchRecursive(basePath, searchFunc, req.MaxResults)
	} else {
		results = h.searchCurrent(basePath, searchFunc, req.MaxResults)
	}

	h.respondSuccess(w, results)
}

func (h *Handler) searchCurrent(path string, matchFunc func(string) bool, maxResults int) []models.FileInfo {
	var results []models.FileInfo

	files, err := os.ReadDir(path)
	if err != nil {
		return results
	}

	for _, file := range files {
		if matchFunc(file.Name()) {
			info, _ := file.Info()
			mimeType := mime.TypeByExtension(filepath.Ext(file.Name()))
			if mimeType == "" {
				mimeType = "application/octet-stream"
			}

			relPath, err := filepath.Rel(h.config.StorageDir, filepath.Join(path, file.Name()))
			if err != nil {
				relPath = filepath.Join(path, file.Name())
			}

			results = append(results, models.FileInfo{
				Name:      file.Name(),
				Path:      filepath.ToSlash(relPath),
				Size:      info.Size(),
				ModTime:   info.ModTime().Format(time.RFC3339),
				IsDir:     file.IsDir(),
				MimeType:  mimeType,
				IsEditable: utils.IsTextFile(mimeType) || utils.IsEditableByExtension(file.Name()),
			})

			if len(results) >= maxResults {
				break
			}
		}
	}

	return results
}

func (h *Handler) searchRecursive(path string, matchFunc func(string) bool, maxResults int) []models.FileInfo {
	var results []models.FileInfo

	err := filepath.Walk(path, func(filePath string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}

		if matchFunc(info.Name()) {
			mimeType := mime.TypeByExtension(filepath.Ext(info.Name()))
			if mimeType == "" {
				mimeType = "application/octet-stream"
			}

			relPath, err := filepath.Rel(h.config.StorageDir, filePath)
			if err != nil {
				relPath = filePath
			}

			results = append(results, models.FileInfo{
				Name:       info.Name(),
				Path:       filepath.ToSlash(relPath),
				Size:       info.Size(),
				ModTime:    info.ModTime().Format(time.RFC3339),
				IsDir:      info.IsDir(),
				MimeType:   mimeType,
				IsEditable: utils.IsTextFile(mimeType) || utils.IsEditableByExtension(info.Name()),
			})

			if len(results) >= maxResults {
				return filepath.SkipAll
			}
		}

		return nil
	})

	if err != nil {
		fmt.Printf("Search error: %v\n", err)
	}

	return results
}

func (h *Handler) GetStorageInfo(w http.ResponseWriter, r *http.Request) {
	var stat syscall.Statfs_t

	err := syscall.Statfs(h.config.StorageDir, &stat)
	if err != nil {
		h.respondError(w, "Cannot get storage info", http.StatusInternalServerError)
		return
	}

	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bfree * uint64(stat.Bsize)
	used := total - free

	h.respondSuccess(w, map[string]interface{}{
		"total": total,
		"free":  free,
		"used":  used,
		"usage_percent": float64(used) / float64(total) * 100,
	})
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

