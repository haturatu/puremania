package handlers

import (
	"os"
	"time"
)

const maxPreparedZips = 8

// storePreparedZip bounds archives waiting for their one-time download URL.
// This protects /tmp even when callers create archives but never follow the
// returned URL.
func (h *Handler) storePreparedZip(token string, prepared preparedZip) bool {
	h.zipDownloadsMu.Lock()
	now := time.Now()
	var expiredPaths []string
	h.zipDownloads.Range(func(key, value interface{}) bool {
		entry, ok := value.(preparedZip)
		if !ok || now.Before(entry.expiresAt) {
			return true
		}
		if _, loaded := h.zipDownloads.LoadAndDelete(key); loaded {
			if h.preparedZipCount > 0 {
				h.preparedZipCount--
			}
			expiredPaths = append(expiredPaths, entry.path)
		}
		return true
	})
	if h.preparedZipCount >= maxPreparedZips {
		h.zipDownloadsMu.Unlock()
		removePreparedZipFiles(expiredPaths)
		return false
	}
	h.zipDownloads.Store(token, prepared)
	h.preparedZipCount++
	h.zipDownloadsMu.Unlock()
	removePreparedZipFiles(expiredPaths)
	return true
}

func (h *Handler) takePreparedZip(token string) (preparedZip, bool) {
	value, loaded := h.zipDownloads.LoadAndDelete(token)
	if !loaded {
		return preparedZip{}, false
	}
	h.zipDownloadsMu.Lock()
	if h.preparedZipCount > 0 {
		h.preparedZipCount--
	}
	h.zipDownloadsMu.Unlock()
	prepared, ok := value.(preparedZip)
	return prepared, ok
}

func (h *Handler) expirePreparedZip(token string) {
	prepared, ok := h.takePreparedZip(token)
	if ok {
		_ = os.Remove(prepared.path)
	}
}

func removePreparedZipFiles(paths []string) {
	for _, path := range paths {
		_ = os.Remove(path)
	}
}
