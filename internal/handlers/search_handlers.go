package handlers

import (
	"context"
	"encoding/json"

	"net/http"
	"os"
	"path/filepath"
	"puremania/internal/types"
	"puremania/internal/utils"
	"regexp"
	"strings"
	"time"
)

type searchRequest struct {
	Term          string `json:"term"`
	Path          string `json:"path"`
	Scope         string `json:"scope"`
	UseRegex      bool   `json:"useRegex"`
	CaseSensitive bool   `json:"caseSensitive"`
	Cursor        string `json:"cursor"`
	Limit         int    `json:"limit"`
}

type searchPage struct {
	Data       []types.FileInfo `json:"data"`
	NextCursor string           `json:"nextCursor,omitempty"`
	HasMore    bool             `json:"hasMore"`
}

// SearchFiles - 並列処理と細かいキャッシュキー使用
func (h *Handler) SearchFiles(w http.ResponseWriter, r *http.Request) {
	var req searchRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.logger.Error("Failed to decode search request", "error", err)
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Term == "" {
		h.respondError(w, "Search term required", http.StatusBadRequest)
		return
	}
	if len(req.Term) > maxSearchTermBytes || len(req.Cursor) > maxVirtualPathBytes {
		h.respondError(w, "Search term or cursor is too long", http.StatusBadRequest)
		return
	}
	if req.Scope != "" && req.Scope != "current" && req.Scope != "recursive" {
		h.respondError(w, "Invalid search scope", http.StatusBadRequest)
		return
	}

	if req.Limit <= 0 || req.Limit > 500 {
		req.Limit = 100
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

	basePath, err := h.convertToPhysicalPath(req.Path)
	if err != nil {
		h.logger.Error("Invalid path for search", "path", req.Path, "error", err)
		h.respondError(w, "Invalid path", http.StatusBadRequest)
		return
	}
	if !contextStillActive(r.Context()) {
		return
	}
	if !tryAcquire(h.searchGate) {
		respondBusy(w)
		return
	}
	defer release(h.searchGate)

	results, searchErr := h.performSearchPage(r.Context(), req, basePath)
	if searchErr == nil {
		h.respondSuccess(w, results)
	} else {
		if searchErr == context.Canceled || searchErr == context.DeadlineExceeded {
			return
		}
		h.logger.Error("Search failed", "error", searchErr)
		h.respondError(w, "Search failed", http.StatusInternalServerError)
	}
}

func (h *Handler) performSearchPage(ctx context.Context, req searchRequest, basePath string) (searchPage, error) {
	match, err := buildSearchMatcher(req)
	if err != nil {
		return searchPage{}, err
	}
	if req.Scope == "recursive" {
		return h.searchRecursivePage(ctx, basePath, req.Cursor, req.Limit, match)
	}
	return h.searchCurrentPage(ctx, basePath, req.Cursor, req.Limit, match)
}

func buildSearchMatcher(req searchRequest) (func(string) bool, error) {
	if req.UseRegex {
		pattern := req.Term
		if !req.CaseSensitive {
			pattern = "(?i)" + pattern
		}
		re, err := regexp.Compile(pattern)
		if err != nil {
			return nil, err
		}
		return re.MatchString, nil
	}
	term := req.Term
	if !req.CaseSensitive {
		term = strings.ToLower(term)
	}
	return func(name string) bool {
		if req.CaseSensitive {
			return strings.Contains(name, term)
		}
		return strings.Contains(strings.ToLower(name), term)
	}, nil
}

func (h *Handler) searchFileInfo(path string, entry os.DirEntry) types.FileInfo {
	var size int64
	var modTime time.Time
	if info, err := entry.Info(); err == nil {
		size = info.Size()
		modTime = info.ModTime()
	}
	mimeType := mediaTypeByPath(entry.Name())
	return types.FileInfo{
		Name: entry.Name(), Path: h.convertToVirtualPath(path), Size: size,
		ModTime: modTime.Format(time.RFC3339), IsDir: entry.IsDir(), MimeType: mimeType,
		IsEditable: utils.IsTextFile(mimeType) || utils.IsEditableByExtension(entry.Name()),
	}
}

func finishSearchPage(results []types.FileInfo, limit int) searchPage {
	hasMore := len(results) > limit
	if hasMore {
		results = results[:limit]
	}
	nextCursor := ""
	if hasMore && len(results) > 0 {
		nextCursor = results[len(results)-1].Path
	}
	return searchPage{Data: results, NextCursor: nextCursor, HasMore: hasMore}
}

func (h *Handler) searchCurrentPage(ctx context.Context, path, cursor string, limit int, match func(string) bool) (searchPage, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return searchPage{}, err
	}
	results := make([]types.FileInfo, 0, limit+1)
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return searchPage{}, err
		}
		fullPath := filepath.Join(path, entry.Name())
		virtualPath := h.convertToVirtualPath(fullPath)
		if virtualPath <= cursor || !match(entry.Name()) {
			continue
		}
		results = append(results, h.searchFileInfo(fullPath, entry))
		if len(results) > limit {
			break
		}
	}
	return finishSearchPage(results, limit), nil
}

func (h *Handler) searchRecursivePage(ctx context.Context, path, cursor string, limit int, match func(string) bool) (searchPage, error) {
	results := make([]types.FileInfo, 0, limit+1)
	err := filepath.WalkDir(path, func(filePath string, entry os.DirEntry, walkErr error) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if walkErr != nil {
			h.logger.Warn("Skipping path in recursive search", "path", filePath, "error", walkErr)
			return nil
		}
		virtualPath := h.convertToVirtualPath(filePath)
		if virtualPath <= cursor || !match(entry.Name()) {
			return nil
		}
		results = append(results, h.searchFileInfo(filePath, entry))
		if len(results) > limit {
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil {
		return searchPage{}, err
	}
	return finishSearchPage(results, limit), nil
}
