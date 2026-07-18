package handlers

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"puremania/cache"
	"puremania/types"
	"sort"
	"strings"
)

var fallbackMediaTypes = map[string]string{
	".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
	".ogv": "video/ogg", ".mov": "video/quicktime", ".mkv": "video/x-matroska",
	".avi": "video/x-msvideo", ".mpeg": "video/mpeg", ".mpg": "video/mpeg", ".ts": "video/mp2t",
	".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".flac": "audio/flac",
	".ogg": "audio/ogg", ".opus": "audio/ogg", ".wav": "audio/wav",
}

func mediaTypeByPath(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	if mediaType := fallbackMediaTypes[ext]; mediaType != "" {
		return mediaType
	}
	if mediaType := mime.TypeByExtension(ext); mediaType != "" {
		return mediaType
	}
	return "application/octet-stream"
}

// 物理パスを仮想パスに変換するメソッド
func (h *Handler) convertToVirtualPath(physicalPath string) string {
	// ストレージディレクトリ内のパスの場合
	if strings.HasPrefix(physicalPath, h.config.StorageDir) {
		relPath, err := filepath.Rel(h.config.StorageDir, physicalPath)
		if err == nil {
			virtualPath := "/" + filepath.ToSlash(relPath)
			return virtualPath
		} else {
			h.logger.Warn("Failed to get relative path from storage dir", "path", physicalPath, "error", err)
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
			} else {
				h.logger.Warn("Failed to get relative path from mount dir", "path", physicalPath, "mount", mountDir, "error", err)
			}
		}
	}

	return physicalPath
}

// 仮想パスを物理パスに変換するメソッド
func (h *Handler) convertToPhysicalPath(virtualPath string) (string, error) {
	var physicalPath string

	if virtualPath == "" || virtualPath == "/" {
		physicalPath = h.config.StorageDir
		return h.ensurePathInAllowedDirs(physicalPath)
	}

	// SpecificDirs のチェック
	for _, specificDir := range h.config.SpecificDirs {
		dirName := filepath.Base(specificDir)
		// Note: 仮想パスはURLなので、常にスラッシュを使うべき
		virtualDirPrefix := "/" + dirName

		if virtualPath == virtualDirPrefix {
			physicalPath = specificDir
			return h.ensurePathInAllowedDirs(physicalPath)
		}
		if strings.HasPrefix(virtualPath, virtualDirPrefix+"/") {
			// TrimPrefixは /dirName/ を取り除く
			relPath := strings.TrimPrefix(virtualPath, virtualDirPrefix+"/")
			// filepath.JoinはOS依存のセパレータを使うので正しい
			physicalPath = filepath.Join(specificDir, relPath)
			return h.ensurePathInAllowedDirs(physicalPath)
		}
	}

	// マウントポイントのチェック
	parts := strings.Split(strings.Trim(virtualPath, "/"), "/")
	if len(parts) > 0 {
		mountName := parts[0]
		for _, mountDir := range h.config.MountDirs {
			if filepath.Base(mountDir) == mountName {
				if len(parts) == 1 {
					physicalPath = mountDir
					return h.ensurePathInAllowedDirs(physicalPath)
				} else {
					relPath := strings.Join(parts[1:], "/")
					physicalPath = filepath.Join(mountDir, relPath)
					return h.ensurePathInAllowedDirs(physicalPath)
				}
			}
		}
	}

	// デフォルトはストレージディレクトリ内
	physicalPath = filepath.Join(h.config.StorageDir, strings.TrimPrefix(virtualPath, "/"))
	return h.ensurePathInAllowedDirs(physicalPath)
}

func (h *Handler) respondSuccess(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(types.APIResponse{
		Success: true,
		Data:    data,
	})
}

func (h *Handler) respondError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(types.APIResponse{
		Success: false,
		Message: message,
	})
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

	hash := md5.New()
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			h.logger.Warn("Failed to get entry info for state key generation", "entry", entry.Name(), "error", err)
			continue
		}
		_, _ = fmt.Fprintf(hash, "%s:%d:%d;", info.Name(), info.Size(), info.ModTime().UnixNano())
	}

	// ルートディレクトリの場合、マウントポイントの情報もキーに含める
	if path == "/" {
		// MountDirsもソートして一貫性を保つ
		sortedMounts := make([]string, len(h.config.MountDirs))
		copy(sortedMounts, h.config.MountDirs)
		sort.Strings(sortedMounts)

		for _, mountDir := range sortedMounts {
			if info, err := os.Stat(mountDir); err == nil {
				_, _ = fmt.Fprintf(hash, "mount_%s:%d:%d;", info.Name(), info.Size(), info.ModTime().UnixNano())
			} else if !os.IsNotExist(err) {
				h.logger.Warn("Failed to stat mount dir for state key generation", "path", mountDir, "error", err)
			}
		}
	}

	return hex.EncodeToString(hash.Sum(nil)), nil
}

// キャッシュ無効化メソッド
func (h *Handler) invalidateFileCache(filePath string) {
	virtualPath := h.convertToVirtualPath(filePath)

	// ファイル関連のキャッシュを無効化
	cache.InvalidateByPrefix(h.cache, "content:"+virtualPath)
	cache.InvalidateByPrefix(h.cache, "list:"+filepath.Dir(virtualPath))
}

// 仮想パスを安全な物理パスに変換し、設定で許可されたディレクトリ内にあることを確認
func (h *Handler) buildSafePath(virtualPath string) (string, error) {
	if strings.Contains(virtualPath, "..") {
		return "", fmt.Errorf("path contains '..': %s", virtualPath)
	}

	physicalPath, err := h.convertToPhysicalPath(virtualPath)
	if err != nil {
		return "", fmt.Errorf("invalid path: %w", err)
	}

	return physicalPath, nil
}

func (h *Handler) ensurePathInAllowedDirs(path string) (string, error) {
	absPhysicalPath, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("could not get absolute path: %w", err)
	}
	absPhysicalPath = filepath.Clean(absPhysicalPath)
	resolvedPath, err := resolveExistingPath(absPhysicalPath)
	if err != nil {
		return "", err
	}

	allowedDirs := make([]string, 0, len(h.config.MountDirs)+1+len(h.config.SpecificDirs))
	allowedDirs = append(allowedDirs, h.config.MountDirs...)
	allowedDirs = append(allowedDirs, h.config.StorageDir)
	allowedDirs = append(allowedDirs, h.config.SpecificDirs...)

	for _, allowedDir := range allowedDirs {
		absAllowedDir, err := filepath.Abs(allowedDir)
		if err != nil {
			h.logger.Warn("Could not get absolute path for allowed dir", "path", allowedDir, "error", err)
			continue
		}
		absAllowedDir = filepath.Clean(absAllowedDir)
		resolvedAllowedDir, err := resolveExistingPath(absAllowedDir)
		if err != nil {
			continue
		}
		if isPathWithin(resolvedAllowedDir, resolvedPath) {
			return resolvedPath, nil
		}
	}

	return "", fmt.Errorf("path is not in an allowed directory: %s", path)
}

// resolveExistingPath resolves every existing path component. This rejects a
// path such as storage/link/file when link points outside an allowed root.
func resolveExistingPath(path string) (string, error) {
	path = filepath.Clean(path)
	var missing []string
	probe := path
	for {
		if _, err := os.Lstat(probe); err == nil {
			resolved, err := filepath.EvalSymlinks(probe)
			if err != nil {
				return "", err
			}
			for i := len(missing) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, missing[i])
			}
			return resolved, nil
		} else if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(probe)
		if parent == probe {
			return "", fmt.Errorf("no existing parent for %s", path)
		}
		missing = append(missing, filepath.Base(probe))
		probe = parent
	}
}

func (h *Handler) isProtectedRoot(path string) bool {
	clean, err := resolveExistingPath(path)
	if err != nil {
		return false
	}
	roots := append([]string{h.config.StorageDir}, h.config.MountDirs...)
	roots = append(roots, h.config.SpecificDirs...)
	for _, root := range roots {
		resolved, err := resolveExistingPath(root)
		if err == nil && clean == filepath.Clean(resolved) {
			return true
		}
	}
	return false
}

func secureJoin(basePath, relPath string) (string, error) {
	absBasePath, err := filepath.Abs(basePath)
	if err != nil {
		return "", fmt.Errorf("could not get absolute base path: %w", err)
	}
	absBasePath = filepath.Clean(absBasePath)

	joinedPath := filepath.Join(absBasePath, relPath)
	absJoinedPath, err := filepath.Abs(joinedPath)
	if err != nil {
		return "", fmt.Errorf("could not get absolute joined path: %w", err)
	}
	absJoinedPath = filepath.Clean(absJoinedPath)

	if !isPathWithin(absBasePath, absJoinedPath) {
		return "", fmt.Errorf("unsafe path: %s", relPath)
	}
	resolvedBase, err := resolveExistingPath(absBasePath)
	if err != nil {
		return "", err
	}
	resolvedPath, err := resolveExistingPath(absJoinedPath)
	if err != nil {
		return "", err
	}
	if !isPathWithin(resolvedBase, resolvedPath) {
		return "", fmt.Errorf("unsafe symlink path: %s", relPath)
	}
	return resolvedPath, nil
}

func atomicWriteFile(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".puremania-writing-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer func() { _ = os.Remove(tmpPath) }()
	if err := tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	err = tmp.Sync()
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer func() { _ = d.Close() }()
	return d.Sync()
}

func isPathWithin(basePath, targetPath string) bool {
	rel, err := filepath.Rel(basePath, targetPath)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}
	parentPrefix := ".." + string(filepath.Separator)
	return rel != ".." && !strings.HasPrefix(rel, parentPrefix)
}
