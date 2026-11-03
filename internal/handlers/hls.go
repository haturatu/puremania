package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"puremania/internal/types"
)

const (
	hlsStartupTimeout = 45 * time.Second
	hlsIdleGrace      = 2 * time.Minute
)

var (
	hlsIDPattern      = regexp.MustCompile(`^[a-f0-9]{64}$`)
	hlsSegmentPattern = regexp.MustCompile(`^segment_[0-9]{6,9}\.tspackage handlers

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"puremania/internal/types"
)

const (
	hlsStartupTimeout = 45 * time.Second
	hlsIdleGrace      = 2 * time.Minute
)

var (
	hlsIDPattern      = regexp.MustCompile(`^[a-f0-9]{64}$`)
	hlsSegmentPattern = )
	errHLSTooBusy     = errors.New("too many concurrent HLS transcodes")
)

type hlsJob struct {
	dir     string
	ready   chan struct{}
	cancel  context.CancelFunc
	running bool
	err     error
}

type hlsManager struct {
	root     string
	maxBytes int64
	maxAge   time.Duration
	ffmpeg   string
	logger   *slog.Logger
	slots    chan struct{}
	ctx      context.Context
	cancel   context.CancelFunc
	mu       sync.Mutex
	jobs     map[string]*hlsJob
	closed   bool
}

func newHLSManager(cfg *types.Config, logger *slog.Logger) (*hlsManager, error) {
	if !cfg.HLSEnabled {
		return nil, nil
	}
	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		return nil, fmt.Errorf("HLS requires ffmpeg: %w", err)
	}
	root, err := filepath.Abs(cfg.HLSCacheDir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(root)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("invalid HLS cache directory")
	}
	ctx, cancel := context.WithCancel(context.Background())
	m := &hlsManager{
		root: root, maxBytes: cfg.HLSCacheMaxMB << 20,
		maxAge: time.Duration(cfg.HLSCacheMaxAgeHours) * time.Hour,
		ffmpeg: ffmpegPath, logger: logger,
		slots: make(chan struct{}, cfg.HLSMaxJobs),
		ctx:   ctx, cancel: cancel, jobs: make(map[string]*hlsJob),
	}
	m.prune()
	go m.maintenance()
	return m, nil
}

func (m *hlsManager) Close() {
	m.mu.Lock()
	m.closed = true
	m.cancel()
	for _, job := range m.jobs {
		if job.running && job.cancel != nil {
			job.cancel()
		}
	}
	m.mu.Unlock()
}

func (m *hlsManager) maintenance() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-m.ctx.Done():
			return
		case <-ticker.C:
			m.prune()
		}
	}
}

func hlsID(source string, info os.FileInfo, quality string) string {
	input := fmt.Sprintf("hls-v1\x00%s\x00%d\x00%d\x00%s", source, info.Size(), info.ModTime().UnixNano(), quality)
	sum := sha256.Sum256([]byte(input))
	return hex.EncodeToString(sum[:])
}

func hlsComplete(dir string) bool {
	data, err := os.ReadFile(filepath.Join(dir, "index.m3u8"))
	return err == nil && strings.Contains(string(data), "#EXT-X-ENDLIST")
}

func hlsReady(dir string) bool {
	if _, err := os.Stat(filepath.Join(dir, "segment_000000.ts")); err != nil {
		return false
	}
	info, err := os.Stat(filepath.Join(dir, "index.m3u8"))
	return err == nil && info.Size() > 0
}

func (m *hlsManager) start(ctx context.Context, file *os.File, source string, info os.FileInfo, quality string) (string, bool, error) {
	if quality != "720" && quality != "480" {
		_ = file.Close()
		return "", false, errors.New("invalid HLS quality")
	}
	m.prune()
	id := hlsID(source, info, quality)
	dir := filepath.Join(m.root, id)
	m.mu.Lock()
	if m.closed {
		m.mu.Unlock()
		_ = file.Close()
		return "", false, errors.New("HLS service is shutting down")
	}
	if job, ok := m.jobs[id]; ok {
		m.mu.Unlock()
		_ = file.Close()
		return m.awaitReady(ctx, id, job)
	}
	if hlsComplete(dir) {
		_ = file.Close()
		job := &hlsJob{dir: dir, ready: make(chan struct{})}
		close(job.ready)
		m.jobs[id] = job
		m.mu.Unlock()
		m.touch(dir)
		return id, true, nil
	}
	// Never reuse interrupted output. Only hex-named directories owned by this
	// service are removed; source files are never written to or deleted.
	_ = os.RemoveAll(dir)
	if err := os.Mkdir(dir, 0700); err != nil {
		m.mu.Unlock()
		_ = file.Close()
		return "", false, err
	}
	select {
	case m.slots <- struct{}{}:
	default:
		m.mu.Unlock()
		_ = file.Close()
		_ = os.RemoveAll(dir)
		return "", false, errHLSTooBusy
	}
	jobCtx, cancel := context.WithCancel(m.ctx)
	job := &hlsJob{dir: dir, ready: make(chan struct{}), running: true, cancel: cancel}
	m.jobs[id] = job
	m.mu.Unlock()
	go m.encode(jobCtx, id, job, file, source, quality)
	return m.awaitReady(ctx, id, job)
}

func (m *hlsManager) awaitReady(ctx context.Context, id string, job *hlsJob) (string, bool, error) {
	timer := time.NewTimer(hlsStartupTimeout)
	defer timer.Stop()
	select {
	case <-job.ready:
		m.mu.Lock()
		err := job.err
		cached := !job.running && err == nil
		m.mu.Unlock()
		if err != nil {
			return "", false, err
		}
		return id, cached, nil
	case <-timer.C:
		return "", false, errors.New("HLS initial segment timed out")
	case <-ctx.Done():
		return "", false, ctx.Err()
	}
}

func (m *hlsManager) encode(ctx context.Context, id string, job *hlsJob, file *os.File, source, quality string) {
	defer func() { _ = file.Close() }()
	defer func() { <-m.slots }()
	// Opening was confined to an allowed root. On Linux ffmpeg receives an
	// inherited file descriptor, avoiding a second path-based open (TOCTOU).
	input, extraFiles := childProcessFilePath(file, source)
	height, rate, buffer := "720", "2400k", "4800k"
	if quality == "480" {
		height, rate, buffer = "480", "1000k", "2000k"
	}
	width := "1280"
	if quality == "480" {
		width = "854"
	}
	filter := fmt.Sprintf("scale=w='min(%s,iw)':h='min(%s,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", width, height)
	args := []string{
		"-nostdin", "-hide_banner", "-loglevel", "error",
		"-threads", "2", "-i", input, "-map", "0:v:0", "-map", "0:a:0?",
		"-vf", filter, "-c:v", "libx264", "-preset", "veryfast",
		"-maxrate", rate, "-bufsize", buffer, "-b:v", rate,
		"-pix_fmt", "yuv420p", "-force_key_frames", "expr:gte(t,n_forced*4)",
		"-sc_threshold", "0", "-c:a", "aac", "-b:a", "96k",
		"-f", "hls", "-hls_time", "4", "-hls_list_size", "0",
		"-hls_playlist_type", "event", "-hls_flags", "temp_file+independent_segments",
		"-hls_segment_filename", filepath.Join(job.dir, "segment_%06d.ts"),
		filepath.Join(job.dir, "index.m3u8"),
	}
	cmd := exec.CommandContext(ctx, m.ffmpeg, args...)
	cmd.ExtraFiles = extraFiles
	var stderr limitedHLSLog
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		m.complete(id, job, err)
		return
	}
	// The child has inherited the input descriptor. Keeping it open in the
	// parent until cmd.Wait is harmless, and makes cleanup predictable.
	wait := make(chan error, 1)
	go func() { wait <- cmd.Wait() }()
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	var err error
	for {
		select {
		case err = <-wait:
			if err == nil && !hlsComplete(job.dir) {
				err = errors.New("ffmpeg exited without a complete playlist")
			}
			if err != nil {
				m.logger.Warn("HLS transcode failed", "error", err, "ffmpeg", stderr.String())
			}
			m.complete(id, job, err)
			return
		case <-ticker.C:
			if hlsReady(job.dir) {
				m.signalReady(job)
			}
		case <-ctx.Done():
			err = <-wait
			if err == nil {
				err = ctx.Err()
			}
			m.complete(id, job, err)
			return
		}
	}
}

type limitedHLSLog struct{ data []byte }

func (b *limitedHLSLog) Write(p []byte) (int, error) {
	if len(b.data) < 8192 {
		n := len(p)
		if n > 8192-len(b.data) {
			n = 8192 - len(b.data)
		}
		b.data = append(b.data, p[:n]...)
	}
	return len(p), nil
}

func (b *limitedHLSLog) String() string { return string(b.data) }

func (m *hlsManager) signalReady(job *hlsJob) {
	m.mu.Lock()
	defer m.mu.Unlock()
	select {
	case <-job.ready:
	default:
		close(job.ready)
	}
}

func (m *hlsManager) complete(id string, job *hlsJob, err error) {
	m.mu.Lock()
	job.err = err
	job.running = false
	job.cancel()
	select {
	case <-job.ready:
	default:
		close(job.ready)
	}
	if err != nil {
		_ = os.RemoveAll(job.dir)
		delete(m.jobs, id)
	}
	m.mu.Unlock()
}

func (m *hlsManager) touch(dir string) {
	now := time.Now()
	_ = os.Chtimes(dir, now, now)
}

type hlsCacheEntry struct {
	name    string
	dir     string
	modTime time.Time
	bytes   int64
	pinned  bool
}

func hlsDirectoryBytes(dir string) int64 {
	var size int64
	_ = filepath.WalkDir(dir, func(_ string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.Type().IsRegular() {
			if info, statErr := entry.Info(); statErr == nil {
				size += info.Size()
			}
		}
		return nil
	})
	return size
}

// prune is the sole cache eviction path. Completed entries are evicted by
// age and least-recently-used order. An active transcode is cancelled if the
// quota still cannot be honored, so an unbounded source cannot fill the disk.
func (m *hlsManager) prune() {
	m.mu.Lock()
	defer m.mu.Unlock()
	dirs, err := os.ReadDir(m.root)
	if err != nil {
		m.logger.Warn("Cannot scan HLS cache", "error", err)
		return
	}
	now := time.Now()
	var total int64
	var candidates []hlsCacheEntry
	for _, entry := range dirs {
		name := entry.Name()
		if !hlsIDPattern.MatchString(name) || !entry.IsDir() {
			continue
		}
		dir := filepath.Join(m.root, name)
		info, err := entry.Info()
		if err != nil {
			continue
		}
		job := m.jobs[name]
		active := job != nil && job.running
		if !active && !hlsComplete(dir) {
			_ = os.RemoveAll(dir)
			delete(m.jobs, name)
			continue
		}
		pinned := active || now.Sub(info.ModTime()) < hlsIdleGrace
		if !pinned && now.Sub(info.ModTime()) > m.maxAge {
			_ = os.RemoveAll(dir)
			delete(m.jobs, name)
			continue
		}
		bytes := hlsDirectoryBytes(dir)
		total += bytes
		if !active {
			candidates = append(candidates, hlsCacheEntry{name, dir, info.ModTime(), bytes, pinned})
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].pinned != candidates[j].pinned {
			return !candidates[i].pinned
		}
		return candidates[i].modTime.Before(candidates[j].modTime)
	})
	for _, entry := range candidates {
		if total <= m.maxBytes {
			break
		}
		if err := os.RemoveAll(entry.dir); err == nil {
			total -= entry.bytes
			delete(m.jobs, entry.name)
		}
	}
	if total > m.maxBytes {
		for _, job := range m.jobs {
			if job.running && job.cancel != nil {
				m.logger.Warn("HLS cache capacity reached; cancelling transcode", "cache_bytes", total, "limit_bytes", m.maxBytes)
				job.cancel()
			}
		}
	}
}

func (h *Handler) StartHLS(w http.ResponseWriter, r *http.Request) {
	if h.hls == nil {
		h.respondError(w, "HLS is disabled or ffmpeg is unavailable", http.StatusServiceUnavailable)
		return
	}
	var input struct {
		Path    string `json:"path"`
		Quality string `json:"quality"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 16<<10)).Decode(&input); err != nil {
		h.respondError(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if input.Quality == "" {
		input.Quality = "720"
	}
	if input.Quality != "720" && input.Quality != "480" {
		h.respondError(w, "Unsupported quality", http.StatusBadRequest)
		return
	}
	if input.Path == "" {
		h.respondError(w, "Path required", http.StatusBadRequest)
		return
	}
	fullPath, err := h.convertToPhysicalPath(input.Path)
	if err != nil {
		h.respondError(w, "Invalid path", http.StatusBadRequest)
		return
	}
	file, err := h.openAllowedPath(fullPath, os.O_RDONLY, 0)
	if err != nil {
		h.respondError(w, "Cannot open video", http.StatusNotFound)
		return
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || !strings.HasPrefix(mediaTypeByPath(input.Path), "video/") {
		_ = file.Close()
		h.respondError(w, "Not a regular video file", http.StatusBadRequest)
		return
	}
	id, cached, err := h.hls.start(r.Context(), file, fullPath, info, input.Quality)
	if err != nil {
		h.logger.Warn("Cannot prepare HLS stream", "error", err)
		h.respondError(w, "Unable to prepare HLS stream", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	h.respondSuccess(w, map[string]interface{}{
		"url":     "/api/hls/" + id + "/index.m3u8",
		"cached":  cached,
		"quality": input.Quality,
	})
}

func (h *Handler) ServeHLS(w http.ResponseWriter, r *http.Request) {
	if h.hls == nil {
		http.NotFound(w, r)
		return
	}
	vars := mux.Vars(r)
	id, asset := vars["id"], vars["asset"]
	if !hlsIDPattern.MatchString(id) || (asset != "index.m3u8" && !hlsSegmentPattern.MatchString(asset)) {
		http.NotFound(w, r)
		return
	}
	dir := filepath.Join(h.hls.root, id)
	path := filepath.Join(dir, asset)
	file, err := os.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	h.hls.touch(dir)
	if asset == "index.m3u8" {
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Set("Cache-Control", "private, no-cache, must-revalidate")
	} else {
		w.Header().Set("Content-Type", "video/mp2t")
		w.Header().Set("Cache-Control", "private, max-age=3600")
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, asset, info.ModTime(), file)
}
