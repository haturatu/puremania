package handlers

import (
	"encoding/json"

	"mime"
	"net/http"
	"os"
	"path/filepath"
	"puremania/cache"
	"puremania/types"
	"puremania/utils"
	"puremania/worker"
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
	if cached, found := cache.Get(h.cache, cacheKey); found {
		if results, ok := cached.([]types.FileInfo); ok {
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
	resultChan := worker.SubmitWithResult(h.workerPool, func() interface{} {
		return h.performSearch(req, basePath)
	})

	result := <-resultChan
	if results, ok := result.([]types.FileInfo); ok {
		// 結果をキャッシュ（検索結果は短めのTTL）
		cache.Set(h.cache, cacheKey, results, int64(len(results)*200), time.Minute*2)
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
}, basePath string) []types.FileInfo {
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
			return []types.FileInfo{}
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
func (h *Handler) searchCurrentParallel(path string, matchFunc func(string) bool, maxResults int) []types.FileInfo {
	var results []types.FileInfo
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
		worker.Submit(h.workerPool, func() {
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
		})
	}

	wg.Wait()
	return results
}

// searchRecursiveParallel - 並列処理で再帰検索
func (h *Handler) searchRecursiveParallel(path string, matchFunc func(string) bool, maxResults int) []types.FileInfo {
	var results []types.FileInfo
	var mu sync.Mutex
	resultCount := int64(0)

	filepath.WalkDir(path, func(filePath string, d os.DirEntry, err error) error {
		if err != nil {
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
				}
			}

			mimeType := mime.TypeByExtension(filepath.Ext(d.Name()))
			if mimeType == "" {
				mimeType = "application/octet-stream"
			}

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
