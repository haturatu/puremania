package handlers

// Resumable upload implementation.  Chunks are copied directly from the HTTP
// body into a temporary file; neither the request nor the completed file is
// ever materialized in application memory.

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"puremania/cache"
	"strconv"
	"strings"
	"time"
)

const resumableUploadDir = ".puremania-upload-sessions"

type uploadSession struct {
	ID            string    `json:"id"`
	Destination   string    `json:"destination"`
	RelativePath  string    `json:"relativePath"`
	TotalBytes    int64     `json:"totalBytes"`
	UploadedBytes int64     `json:"uploadedBytes"`
	Completed     bool      `json:"completed"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
	Fingerprint   string    `json:"fingerprint,omitempty"`
}

type createUploadRequest struct {
	Path         string `json:"path"`
	RelativePath string `json:"relativePath"`
	Size         int64  `json:"size"`
	Fingerprint  string `json:"fingerprint"`
}

func (h *Handler) uploadSessionDir() string {
	return filepath.Join(h.config.StorageDir, resumableUploadDir)
}
func (h *Handler) uploadMetadataPath(id string) string {
	return filepath.Join(h.uploadSessionDir(), id+".json")
}
func (h *Handler) uploadTempPath(id string) string {
	return filepath.Join(h.uploadSessionDir(), id+".part")
}

// Sessions are durable across process restarts. Expired abandoned sessions are
// reclaimed at startup; the TTL is deliberately long enough for a user to
// resume an interrupted large upload on another day.
func (h *Handler) cleanupExpiredUploadSessions() {
	entries, err := os.ReadDir(h.uploadSessionDir())
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-time.Duration(h.config.UploadSessionTTLHours) * time.Hour)
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		id := strings.TrimSuffix(entry.Name(), ".json")
		session, readErr := h.readUploadSession(id)
		if readErr != nil || session.UpdatedAt.Before(cutoff) {
			_ = os.Remove(h.uploadMetadataPath(id))
			_ = os.Remove(h.uploadTempPath(id))
		}
	}
}

func newUploadID() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func validUploadID(id string) bool {
	if len(id) != 48 {
		return false
	}
	_, err := hex.DecodeString(id)
	return err == nil
}

func (h *Handler) readUploadSession(id string) (*uploadSession, error) {
	if !validUploadID(id) {
		return nil, errors.New("invalid upload id")
	}
	b, err := os.ReadFile(h.uploadMetadataPath(id))
	if err != nil {
		return nil, err
	}
	var session uploadSession
	if err := json.Unmarshal(b, &session); err != nil {
		return nil, err
	}
	if session.ID != id {
		return nil, errors.New("invalid upload session")
	}
	return &session, nil
}

func (h *Handler) writeUploadSession(session *uploadSession) error {
	session.UpdatedAt = time.Now().UTC()
	b, err := json.Marshal(session)
	if err != nil {
		return err
	}
	tmp := h.uploadMetadataPath(session.ID) + ".new"
	if err := os.WriteFile(tmp, b, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, h.uploadMetadataPath(session.ID))
}

// CreateUpload creates a durable upload session and returns its dedicated URL.
func (h *Handler) CreateUpload(w http.ResponseWriter, r *http.Request) {
	var req createUploadRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&req); err != nil {
		h.respondError(w, "Invalid upload request", http.StatusBadRequest)
		return
	}
	if req.Path == "" {
		req.Path = "/"
	}
	if req.Size < 0 || req.Size > h.config.MaxFileSize<<20 || req.RelativePath == "" || len(req.Path) > maxVirtualPathBytes || len(req.RelativePath) > maxRelativePathBytes {
		h.respondError(w, "Invalid upload size or path", http.StatusBadRequest)
		return
	}
	destination, err := h.convertToPhysicalPath(req.Path)
	if err != nil {
		h.respondError(w, "Invalid path: "+err.Error(), http.StatusBadRequest)
		return
	}
	relativePath := filepath.FromSlash(req.RelativePath)
	if _, err := secureJoin(destination, relativePath); err != nil {
		h.respondError(w, "Invalid relative path", http.StatusBadRequest)
		return
	}
	if err := os.MkdirAll(h.uploadSessionDir(), 0700); err != nil {
		h.respondError(w, "Cannot create upload session", http.StatusInternalServerError)
		return
	}
	id, err := newUploadID()
	if err != nil {
		h.respondError(w, "Cannot create upload session", http.StatusInternalServerError)
		return
	}
	now := time.Now().UTC()
	if req.Fingerprint == "" || len(req.Fingerprint) != sha256.Size*2 {
		h.respondError(w, "Invalid upload fingerprint", http.StatusBadRequest)
		return
	}
	if _, err := hex.DecodeString(req.Fingerprint); err != nil {
		h.respondError(w, "Invalid upload fingerprint", http.StatusBadRequest)
		return
	}
	session := &uploadSession{ID: id, Destination: destination, RelativePath: relativePath, TotalBytes: req.Size, CreatedAt: now, UpdatedAt: now, Fingerprint: req.Fingerprint}
	// Reserve storage before acknowledging the session. KEEP_SIZE allocation
	// preserves resumable writes' logical length and catches ENOSPC early.
	part, createErr := os.OpenFile(h.uploadTempPath(id), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if createErr != nil {
		h.respondError(w, "Cannot create upload data", http.StatusInternalServerError)
		return
	}
	if req.Size > 0 && h.config.PreallocateUploads {
		createErr = preallocateUpload(part, req.Size)
	}
	if closeErr := part.Close(); createErr == nil {
		createErr = closeErr
	}
	if createErr != nil {
		_ = os.Remove(h.uploadTempPath(id))
		h.respondError(w, "Cannot reserve upload storage", http.StatusInsufficientStorage)
		return
	}
	if err := h.writeUploadSession(session); err != nil {
		_ = os.Remove(h.uploadTempPath(id))
		h.respondError(w, "Cannot save upload session", http.StatusInternalServerError)
		return
	}
	h.publishUploadState(session, false)
	location := "/api/files/upload-sessions/" + id
	w.Header().Set("Location", location)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"uploadId": id, "uploadURL": location, "uploadedBytes": int64(0), "fingerprint": req.Fingerprint})
}

func parseContentRange(value string) (int64, int64, int64, error) {
	var start, end, total int64
	if _, err := fmt.Sscanf(value, "bytes %d-%d/%d", &start, &end, &total); err != nil || start < 0 || end < start || total < 0 {
		return 0, 0, 0, errors.New("invalid Content-Range")
	}
	return start, end, total, nil
}

func (h *Handler) resumeFingerprint(session *uploadSession) (string, int64) {
	length := min(session.UploadedBytes, int64(1024*1024))
	if length == 0 || session.Completed {
		return "", 0
	}
	offset := session.UploadedBytes - length
	part, err := os.Open(h.uploadTempPath(session.ID))
	if err != nil {
		return "", 0
	}
	defer func() { _ = part.Close() }()
	hash := sha256.New()
	if _, err := io.Copy(hash, io.NewSectionReader(part, offset, length)); err != nil {
		return "", 0
	}
	return hex.EncodeToString(hash.Sum(nil)), offset
}

func (h *Handler) writeUploadPosition(w http.ResponseWriter, session *uploadSession, status int) {
	if session.UploadedBytes > 0 {
		w.Header().Set("Range", "bytes=0-"+strconv.FormatInt(session.UploadedBytes-1, 10))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	resumeFingerprint, resumeOffset := h.resumeFingerprint(session)
	_ = json.NewEncoder(w).Encode(map[string]any{"uploadedBytes": session.UploadedBytes, "totalBytes": session.TotalBytes, "completed": session.Completed, "fingerprint": session.Fingerprint, "resumeFingerprint": resumeFingerprint, "resumeOffset": resumeOffset})
}

// UploadChunk accepts only the next contiguous range. A completely acknowledged
// range may be resent safely (for example when its response was lost).
func (h *Handler) UploadChunk(w http.ResponseWriter, r *http.Request) {
	id := filepath.Base(filepath.Dir(r.URL.Path))
	lock := h.sessionMutex(id)
	lock.Lock()
	defer lock.Unlock()
	session, err := h.readUploadSession(id)
	if err != nil {
		h.respondError(w, "Upload session not found", http.StatusNotFound)
		return
	}
	start, end, total, err := parseContentRange(r.Header.Get("Content-Range"))
	if err != nil || total != session.TotalBytes || end >= total || r.ContentLength >= 0 && r.ContentLength != end-start+1 {
		h.respondError(w, "Invalid Content-Range", http.StatusBadRequest)
		return
	}
	if session.Completed {
		h.writeUploadPosition(w, session, http.StatusOK)
		return
	}
	if end < session.UploadedBytes {
		h.writeUploadPosition(w, session, http.StatusPermanentRedirect)
		return
	}
	if start != session.UploadedBytes {
		h.writeUploadPosition(w, session, http.StatusConflict)
		return
	}
	queueStart := time.Now()
	select {
	case h.uploadGate <- struct{}{}:
	case <-r.Context().Done():
		return
	}
	queueDelay := time.Since(queueStart)
	defer func() { <-h.uploadGate }()
	writeStart := time.Now()
	part, err := os.OpenFile(h.uploadTempPath(id), os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		h.respondError(w, "Cannot open upload data", http.StatusInternalServerError)
		return
	}
	defer func() { _ = part.Close() }()
	if err := part.Truncate(start); err != nil {
		h.respondError(w, "Cannot reset upload data", http.StatusInternalServerError)
		return
	}
	if _, err := part.Seek(start, io.SeekStart); err != nil {
		h.respondError(w, "Cannot seek upload data", http.StatusInternalServerError)
		return
	}
	expected := end - start + 1
	// Keep large sequential uploads from becoming valuable page-cache residents.
	// This is advisory and does not alter the stream or the on-disk bytes.
	prepareUploadRange(part, start, expected)
	written, copyErr := io.CopyBuffer(part, io.LimitReader(r.Body, expected), make([]byte, 128*1024))
	if copyErr != nil || written != expected {
		_ = part.Truncate(start)
		h.respondError(w, "Incomplete upload chunk", http.StatusBadRequest)
		return
	}
	var extra [1]byte
	if n, _ := r.Body.Read(extra[:]); n != 0 {
		_ = part.Truncate(start)
		h.respondError(w, "Upload chunk exceeds Content-Range", http.StatusBadRequest)
		return
	}
	if err := part.Sync(); err != nil {
		h.respondError(w, "Cannot save upload chunk", http.StatusInternalServerError)
		return
	}
	// Only evict data that has been durably flushed; a retry can always write a
	// chunk again, but this avoids retaining multi-gigabyte page cache per upload.
	releaseUploadRange(part, start, written)
	writeTime := time.Since(writeStart)
	// Telemetry is advisory: it lets clients distinguish disk contention from
	// network saturation without coupling correctness to a specific algorithm.
	w.Header().Set("Upload-Queue-Delay", strconv.FormatInt(queueDelay.Milliseconds(), 10))
	w.Header().Set("Upload-Write-Time", strconv.FormatInt(writeTime.Milliseconds(), 10))
	// Report the gate's fixed capacity and the occupancy at this response's
	// write point separately. The previous recommendation header mixed the two
	// values, causing clients to mistake instantaneous free capacity for a
	// server-wide concurrency limit.
	w.Header().Set("Upload-Concurrency-Capacity", strconv.Itoa(cap(h.uploadGate)))
	w.Header().Set("Upload-Concurrency-Active", strconv.Itoa(len(h.uploadGate)))
	session.UploadedBytes += written
	if err := h.writeUploadSession(session); err != nil {
		h.respondError(w, "Cannot persist upload progress", http.StatusInternalServerError)
		return
	}
	h.publishUploadState(session, false)
	status := http.StatusPermanentRedirect
	if session.UploadedBytes == session.TotalBytes {
		status = http.StatusOK
	}
	h.writeUploadPosition(w, session, status)
}

func (h *Handler) UploadStatus(w http.ResponseWriter, r *http.Request) {
	id := filepath.Base(r.URL.Path)
	lock := h.sessionMutex(id)
	lock.Lock()
	defer lock.Unlock()
	session, err := h.readUploadSession(id)
	if err != nil {
		h.respondError(w, "Upload session not found", http.StatusNotFound)
		return
	}
	h.writeUploadPosition(w, session, http.StatusOK)
}

func (h *Handler) CompleteUpload(w http.ResponseWriter, r *http.Request) {
	id := filepath.Base(filepath.Dir(r.URL.Path))
	lock := h.sessionMutex(id)
	lock.Lock()
	defer lock.Unlock()
	session, err := h.readUploadSession(id)
	if err != nil {
		h.respondError(w, "Upload session not found", http.StatusNotFound)
		return
	}
	if session.Completed {
		h.respondSuccess(w, map[string]any{"path": h.convertToVirtualPath(filepath.Join(session.Destination, session.RelativePath))})
		return
	}
	if session.UploadedBytes != session.TotalBytes {
		h.respondError(w, "Upload is incomplete", http.StatusConflict)
		return
	}
	target, err := secureJoin(session.Destination, session.RelativePath)
	if err != nil {
		h.respondError(w, "Invalid upload destination", http.StatusBadRequest)
		return
	}
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		h.respondError(w, "Cannot create destination directory", http.StatusInternalServerError)
		return
	}
	partPath := h.uploadTempPath(id)
	if _, err := os.Stat(partPath); os.IsNotExist(err) {
		if info, statErr := os.Stat(target); statErr == nil && info.Size() == session.TotalBytes {
			session.Completed = true
			if err := h.writeUploadSession(session); err != nil {
				h.respondError(w, "Cannot persist completed upload", http.StatusInternalServerError)
				return
			}
			cache.InvalidateByPrefix(h.cache, "list:"+filepath.Dir(h.convertToVirtualPath(target)))
			cache.InvalidateByPrefix(h.cache, "search:")
			h.publishUploadState(session, false)
			h.respondSuccess(w, map[string]any{"path": h.convertToVirtualPath(target)})
			return
		}
	}
	part, err := os.OpenFile(partPath, os.O_WRONLY, 0600)
	if err != nil {
		h.respondError(w, "Cannot finalize upload", http.StatusInternalServerError)
		return
	}
	truncateErr := part.Truncate(session.TotalBytes)
	var syncErr error
	if truncateErr == nil {
		syncErr = part.Sync()
	}
	closeErr := part.Close()
	if truncateErr != nil || syncErr != nil || closeErr != nil {
		h.respondError(w, "Cannot finalize upload", http.StatusInternalServerError)
		return
	}
	if err := os.Rename(partPath, target); err != nil {
		h.respondError(w, "Cannot finalize upload", http.StatusInternalServerError)
		return
	}
	session.Completed = true
	if err := h.writeUploadSession(session); err != nil {
		h.logger.Error("Upload completed but session metadata update failed", "id", id, "error", err)
		h.respondError(w, "Cannot persist completed upload", http.StatusInternalServerError)
		return
	}
	cache.InvalidateByPrefix(h.cache, "list:"+filepath.Dir(h.convertToVirtualPath(target)))
	cache.InvalidateByPrefix(h.cache, "search:")
	h.publishUploadState(session, false)
	h.respondSuccess(w, map[string]any{"path": h.convertToVirtualPath(target)})
}

func (h *Handler) AbortUpload(w http.ResponseWriter, r *http.Request) {
	id := filepath.Base(r.URL.Path)
	lock := h.sessionMutex(id)
	lock.Lock()
	defer lock.Unlock()
	session, err := h.readUploadSession(id)
	if err != nil {
		h.respondError(w, "Upload session not found", http.StatusNotFound)
		return
	}
	_ = os.Remove(h.uploadTempPath(id))
	_ = os.Remove(h.uploadMetadataPath(id))
	h.publishUploadState(session, true)
	w.WriteHeader(http.StatusNoContent)
}
