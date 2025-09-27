package handlers

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"puremania/cache"
	"puremania/types"
	"sort"
	"strings"
)

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

	var stateBuilder strings.Builder
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			h.logger.Warn("Failed to get entry info for state key generation", "entry", entry.Name(), "error", err)
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
			} else if !os.IsNotExist(err) {
				h.logger.Warn("Failed to stat mount dir for state key generation", "path", mountDir, "error", err)
			}
		}
	}

	hash := md5.Sum([]byte(stateBuilder.String()))
	return hex.EncodeToString(hash[:]), nil
}

// キャッシュ無効化メソッド
func (h *Handler) invalidateFileCache(filePath string) {
	virtualPath := h.convertToVirtualPath(filePath)

	// ファイル関連のキャッシュを無効化
	cache.InvalidateByPrefix(h.cache, "content:"+virtualPath)
	cache.InvalidateByPrefix(h.cache, "list:"+filepath.Dir(virtualPath))
}

// 検索条件のハッシュ化でキー生成
func (h *Handler) generateSearchCacheKey(term, path, scope string, useRegex, caseSensitive bool, maxResults int) string {
	data := fmt.Sprintf("search:%s:%s:%s:%t:%t:%d", term, path, scope, useRegex, caseSensitive, maxResults)
	hash := md5.Sum([]byte(data))
	return "search:" + hex.EncodeToString(hash[:])
}

// 仮想パスを安全な物理パスに変換し、設定で許可されたディレクトリ内にあることを確認
func (h *Handler) buildSafePath(virtualPath string) (string, error) {
	physicalPath, err := h.convertToPhysicalPath(virtualPath)
	if err != nil {
		return "", fmt.Errorf("invalid path: %w", err)
	}

	// パスが許可されたディレクトリ内にあるか検証
	isSafe := false
	absPhysicalPath, err := filepath.Abs(physicalPath)
	if err != nil {
		return "", fmt.Errorf("could not get absolute path: %w", err)
	}

	allowedDirs := append(h.config.MountDirs, h.config.StorageDir)
	allowedDirs = append(allowedDirs, h.config.SpecificDirs...)

	for _, allowedDir := range allowedDirs {
		absAllowedDir, err := filepath.Abs(allowedDir)
		if err != nil {
			h.logger.Warn("Could not get absolute path for allowed dir", "path", allowedDir, "error", err)
			continue // or log error
		}
		if strings.HasPrefix(absPhysicalPath, absAllowedDir) {
			isSafe = true
			break
		}
	}

	if !isSafe {
		return "", fmt.Errorf("path is not in an allowed directory: %s", virtualPath)
	}

	// .. を含むパスを拒否
	if strings.Contains(virtualPath, "..") {
		return "", fmt.Errorf("path contains '..': %s", virtualPath)
	}

	return physicalPath, nil
}
