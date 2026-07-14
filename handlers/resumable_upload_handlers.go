package handlers

// Resumable upload implementation.  Chunks are copied directly from the HTTP
// body into a temporary file; neither the request nor the completed file is
// ever materialized in application memory.

import (
	"crypto/rand"
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
	"sync"
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
}

type createUploadRequest struct {
	Path         string `json:"path"`
	RelativePath string `json:"relativePath"`
	Size         int64  `json:"size"`
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

func (h *Handler) sessionMutex(id string) *sync.Mutex {
	lock, _ := h.uploadLocks.LoadOrStore(id, &sync.Mutex{})
	return lock.(*sync.Mutex)
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
	if req.Size < 0 || req.Size > h.config.MaxFileSize<<20 || req.RelativePath == "" {
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
	session := &uploadSession{ID: id, Destination: destination, RelativePath: relativePath, TotalBytes: req.Size, CreatedAt: now, UpdatedAt: now}
	// A zero-byte upload has no chunk request. Create its empty part now so
	// completion follows the same atomic rename path as every other upload.
	if req.Size == 0 {
		part, createErr := os.OpenFile(h.uploadTempPath(id), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if createErr != nil {
			h.respondError(w, "Cannot create upload data", http.StatusInternalServerError)
			return
		}
		_ = part.Close()
	}
	if err := h.writeUploadSession(session); err != nil {
		_ = os.Remove(h.uploadTempPath(id))
		h.respondError(w, "Cannot save upload session", http.StatusInternalServerError)
		return
	}
	location := "/api/files/upload-sessions/" + id
	w.Header().Set("Location", location)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(map[string]any{"uploadId": id, "uploadURL": location, "uploadedBytes": int64(0)})
}

func parseContentRange(value string) (int64, int64, int64, error) {
	var start, end, total int64
	if _, err := fmt.Sscanf(value, "bytes %d-%d/%d", &start, &end, &total); err != nil || start < 0 || end < start || total < 0 {
		return 0, 0, 0, errors.New("invalid Content-Range")
	}
	return start, end, total, nil
}

func writeUploadPosition(w http.ResponseWriter, session *uploadSession, status int) {
	if session.UploadedBytes > 0 {
		w.Header().Set("Range", "bytes=0-"+strconv.FormatInt(session.UploadedBytes-1, 10))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"uploadedBytes": session.UploadedBytes, "totalBytes": session.TotalBytes, "completed": session.Completed})
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
		writeUploadPosition(w, session, http.StatusOK)
		return
	}
	if end < session.UploadedBytes {
		writeUploadPosition(w, session, http.StatusPermanentRedirect)
		return
	}
	if start != session.UploadedBytes {
		writeUploadPosition(w, session, http.StatusConflict)
		return
	}
	part, err := os.OpenFile(h.uploadTempPath(id), os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		h.respondError(w, "Cannot open upload data", http.StatusInternalServerError)
		return
	}
	defer part.Close()
	if _, err := part.Seek(start, io.SeekStart); err != nil {
		h.respondError(w, "Cannot seek upload data", http.StatusInternalServerError)
		return
	}
	expected := end - start + 1
	written, copyErr := io.CopyBuffer(part, io.LimitReader(r.Body, expected+1), make([]byte, 128*1024))
	if copyErr != nil || written != expected {
		h.respondError(w, "Incomplete upload chunk", http.StatusBadRequest)
		return
	}
	if err := part.Sync(); err != nil {
		h.respondError(w, "Cannot save upload chunk", http.StatusInternalServerError)
		return
	}
	session.UploadedBytes += written
	if err := h.writeUploadSession(session); err != nil {
		h.respondError(w, "Cannot persist upload progress", http.StatusInternalServerError)
		return
	}
	status := http.StatusPermanentRedirect
	if session.UploadedBytes == session.TotalBytes {
		status = http.StatusOK
	}
	writeUploadPosition(w, session, status)
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
	writeUploadPosition(w, session, http.StatusOK)
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
	if err := os.Rename(h.uploadTempPath(id), target); err != nil {
		h.respondError(w, "Cannot finalize upload", http.StatusInternalServerError)
		return
	}
	session.Completed = true
	if err := h.writeUploadSession(session); err != nil {
		h.logger.Error("Upload completed but session metadata update failed", "id", id, "error", err)
	}
	cache.InvalidateByPrefix(h.cache, "list:"+filepath.Dir(h.convertToVirtualPath(target)))
	cache.InvalidateByPrefix(h.cache, "search:")
	h.respondSuccess(w, map[string]any{"path": h.convertToVirtualPath(target)})
}

func (h *Handler) AbortUpload(w http.ResponseWriter, r *http.Request) {
	id := filepath.Base(r.URL.Path)
	lock := h.sessionMutex(id)
	lock.Lock()
	defer lock.Unlock()
	if _, err := h.readUploadSession(id); err != nil {
		h.respondError(w, "Upload session not found", http.StatusNotFound)
		return
	}
	_ = os.Remove(h.uploadTempPath(id))
	_ = os.Remove(h.uploadMetadataPath(id))
	h.uploadLocks.Delete(id)
	w.WriteHeader(http.StatusNoContent)
}
