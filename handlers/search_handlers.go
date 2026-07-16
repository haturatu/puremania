package handlers

import (
	"context"
	"encoding/json"

	"net/http"
	"os"
	"path/filepath"
	"puremania/cache"
	"puremania/types"
	"puremania/utils"
	"regexp"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

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
		h.logger.Error("Failed to decode search request", "error", err)
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Term == "" {
		h.respondError(w, "Search term required", http.StatusBadRequest)
		return
	}

	if req.MaxResults <= 0 || req.MaxResults > 10000 {
		req.MaxResults = 1000
	}
	if req.UseRegex {
		pattern := req.Term
		if !req.CaseSensitive {
			pattern = "(?i)" + pattern
		}
		if _, err := regexp.Compile(pattern); err != nil {
			h.respondError(w, "Invalid regular expression", http.StatusBadRequest)
			return
		}
	}

	// 細かいキャッシュキーを生成
	cacheKey := h.generateSearchCacheKey(req.Term, req.Path, req.Scope, req.UseRegex, req.CaseSensitive, req.MaxResults)
	if cached, found := cache.Get(h.cache, cacheKey); found {
		if results, ok := cached.([]types.FileInfo); ok {
			h.respondSuccess(w, results)
			return
		}
	}

	basePath, err := h.convertToPhysicalPath(req.Path)
	if err != nil {
		h.logger.Error("Invalid path for search", "path", req.Path, "error", err)
		h.respondError(w, "Invalid path", http.StatusBadRequest)
		return
	}

	results, searchErr := h.performSearch(r.Context(), req, basePath)
	if searchErr == nil {
		// 結果をキャッシュ（検索結果は短めのTTL）
		cache.Set(h.cache, cacheKey, results, int64(len(results)*200), time.Minute*2)
		h.respondSuccess(w, results)
	} else {
		if searchErr == context.Canceled || searchErr == context.DeadlineExceeded {
			return
		}
		h.logger.Error("Search failed", "error", searchErr)
		h.respondError(w, "Search failed", http.StatusInternalServerError)
	}
}

func (h *Handler) performSearch(ctx context.Context, req struct {
	Term          string `json:"term"`
	Path          string `json:"path"`
	Scope         string `json:"scope"`
	UseRegex      bool   `json:"useRegex"`
	CaseSensitive bool   `json:"caseSensitive"`
	MaxResults    int    `json:"maxResults"`
}, basePath string) ([]types.FileInfo, error) {
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
			h.logger.Error("Invalid regex in search", "term", req.Term, "error", err)
			return nil, err
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
		return h.searchRecursiveParallel(ctx, basePath, searchFunc, req.MaxResults), nil
	} else {
		return h.searchCurrentParallel(ctx, basePath, searchFunc, req.MaxResults), nil
	}
}

// searchCurrentParallel - 並列処理で現在ディレクトリ検索
func (h *Handler) searchCurrentParallel(ctx context.Context, path string, matchFunc func(string) bool, maxResults int) []types.FileInfo {
	var results []types.FileInfo
	var mu sync.Mutex

	entries, err := os.ReadDir(path)
	if err != nil {
		h.logger.Error("Failed to read directory for search", "path", path, "error", err)
		return results
	}

	var wg sync.WaitGroup
	resultCount := int64(0)

	for _, entry := range entries {
		if ctx.Err() != nil {
			break
		}
		if atomic.LoadInt64(&resultCount) >= int64(maxResults) {
			break
		}

		select {
		case <-ctx.Done():
			break
		default:
		}
		wg.Add(1)
		func() {
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
					} else if !os.IsNotExist(err) {
						h.logger.Warn("Failed to get entry info during search", "entry", entry.Name(), "error", err)
					}
				}

				mimeType := mediaTypeByPath(entry.Name())

				fullPath := filepath.Join(path, entry.Name())
				virtualPath := h.convertToVirtualPath(fullPath)

				fileInfo := types.FileInfo{
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
		}()
	}

	wg.Wait()
	return results
}

// searchRecursiveParallel - 並列処理で再帰検索
func (h *Handler) searchRecursiveParallel(ctx context.Context, path string, matchFunc func(string) bool, maxResults int) []types.FileInfo {
	var results []types.FileInfo
	var mu sync.Mutex
	resultCount := int64(0)

	_ = filepath.WalkDir(path, func(filePath string, d os.DirEntry, err error) error {
		select {
		case <-ctx.Done():
			return filepath.SkipAll
		default:
		}
		if err != nil {
			h.logger.Warn("Skipping path in recursive search due to error", "path", filePath, "error", err)
			return nil // エラーをスキップして継続
		}

		if atomic.LoadInt64(&resultCount) >= int64(maxResults) {
			return filepath.SkipAll
		}

		if matchFunc(d.Name()) {
			var size int64
			var modTime time.Time

			if d.Type().IsRegular() || d.IsDir() {
				if info, err := d.Info(); err == nil {
					size = info.Size()
					modTime = info.ModTime()
				} else if !os.IsNotExist(err) {
					h.logger.Warn("Failed to get entry info during recursive search", "entry", d.Name(), "error", err)
				}
			}

			mimeType := mediaTypeByPath(d.Name())

			virtualPath := h.convertToVirtualPath(filePath)

			fileInfo := types.FileInfo{
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
		}

		return nil
	})

	// 結果をソート
	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})

	return results
}
