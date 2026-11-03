package handlers

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/mux"
	"puremania/internal/types"
)

func testHLSManager(t *testing.T, quota int64) *hlsManager {
	t.Helper()
	root := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	return &hlsManager{
		root: root, maxBytes: quota, maxAge: 72 * time.Hour,
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		ctx:    ctx, cancel: cancel, slots: make(chan struct{}, 1),
		streams: make(map[string]*hlsStream), jobs: make(map[string]*hlsChunkJob),
	}
}

func testHLSCache(t *testing.T, m *hlsManager, id string, bytes int, accessed time.Time, complete bool) string {
	t.Helper()
	dir := filepath.Join(m.root, id)
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.m3u8"), []byte(hlsPlaylist(24)), 0600); err != nil {
		t.Fatal(err)
	}
	chunk := filepath.Join(dir, "chunk_000000")
	if err := os.Mkdir(chunk, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(chunk, "segment_000000.ts"), make([]byte, bytes), 0600); err != nil {
		t.Fatal(err)
	}
	if complete {
		if err := os.WriteFile(filepath.Join(chunk, ".complete"), []byte("ok"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chtimes(dir, accessed, accessed); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(chunk, accessed, accessed); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestHLSPlaylistIsFullDurationAndSeekable(t *testing.T) {
	list := hlsPlaylist(25)
	for _, part := range []string{
		"#EXT-X-PLAYLIST-TYPE:VOD", "#EXT-X-ENDLIST",
		"chunk_000000/segment_000000.ts",
		"chunk_000001/segment_000004.ts",
		"chunk_000001/segment_000006.ts",
		"#EXTINF:1.000,",
		"#EXT-X-DISCONTINUITY",
	} {
		if !strings.Contains(list, part) {
			t.Errorf("playlist missing %q", part)
		}
	}
	if strings.Count(list, "#EXTINF:") != 7 {
		t.Fatal("wrong segment count")
	}
}

func TestHLSCacheEvictsOldestWithinQuota(t *testing.T) {
	m := testHLSManager(t, 1500)
	now := time.Now()
	old := testHLSCache(t, m, strings.Repeat("a", 64), 400, now.Add(-5*time.Hour), true)
	recent := testHLSCache(t, m, strings.Repeat("b", 64), 400, now.Add(-3*time.Hour), true)
	m.prune()
	if _, err := os.Stat(filepath.Join(old, "chunk_000000")); !os.IsNotExist(err) {
		t.Fatalf("oldest cache chunk not evicted: %v", err)
	}
	if _, err := os.Stat(recent); err != nil {
		t.Fatalf("new cache was evicted: %v", err)
	}
}

func TestHLSCacheExpiresOldEntries(t *testing.T) {
	m := testHLSManager(t, 1<<20)
	expired := testHLSCache(t, m, strings.Repeat("c", 64), 200, time.Now().Add(-96*time.Hour), true)
	other := filepath.Join(m.root, "unrelated")
	if err := os.Mkdir(other, 0700); err != nil {
		t.Fatal(err)
	}
	m.prune()
	if _, err := os.Stat(expired); !os.IsNotExist(err) {
		t.Fatalf("expired cache not removed: %v", err)
	}
	if _, err := os.Stat(other); err != nil {
		t.Fatalf("unrelated dir removed: %v", err)
	}
}

func TestHLSActiveChunkCancelledBeforeQuotaOverrun(t *testing.T) {
	m := testHLSManager(t, 100)
	id := strings.Repeat("d", 64)
	dir := testHLSCache(t, m, id, 200, time.Now(), false)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	m.jobs[id+":0"] = &hlsChunkJob{dir: filepath.Join(dir, "chunk_000000"), cancel: cancel, done: make(chan struct{})}
	m.prune()
	if ctx.Err() != context.Canceled {
		t.Fatal("active conversion was not cancelled when cache over quota")
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("active output deleted before FFmpeg stopped: %v", err)
	}
}

func TestHLSAssetSafetyAndContentType(t *testing.T) {
	m := testHLSManager(t, 1<<20)
	id := strings.Repeat("e", 64)
	dir := testHLSCache(t, m, id, 200, time.Now(), true)
	m.streams[id] = &hlsStream{id: id, dir: dir, segmentCount: 6, lastViewed: time.Now()}
	h := &Handler{hls: m}
	tests := []struct {
		chunk, asset string
		want         int
		mime         string
	}{
		{"", "index.m3u8", http.StatusOK, "application/vnd.apple.mpegurl"},
		{"chunk_000000", "segment_000000.ts", http.StatusOK, "video/mp2t"},
		{"chunk_000001", "segment_000000.ts", http.StatusNotFound, ""},
		{"chunk_000000", "segment_000000.ts.tmp", http.StatusNotFound, ""},
		{"..", "index.m3u8", http.StatusNotFound, ""},
	}
	for _, tc := range tests {
		vars := map[string]string{"id": id, "asset": tc.asset}
		if tc.chunk != "" {
			vars["chunk"] = tc.chunk
		}
		req := mux.SetURLVars(httptest.NewRequest("GET", "/api/hls/", nil), vars)
		rec := httptest.NewRecorder()
		h.ServeHLS(rec, req)
		if rec.Code != tc.want {
			t.Errorf("%s/%s status=%d want=%d", tc.chunk, tc.asset, rec.Code, tc.want)
		}
		if tc.mime != "" && rec.Header().Get("Content-Type") != tc.mime {
			t.Errorf("wrong MIME: %s", rec.Header().Get("Content-Type"))
		}
	}
}

func TestHLSSegmentRandomSeekAndCacheReuse(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg absent")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		t.Skip("ffprobe absent")
	}
	source := filepath.Join(t.TempDir(), "video.mp4")
	cmd := exec.Command("ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10", "-t", "24", "-c:v", "mpeg4", "-y", source)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("test fixture unavailable: %v (%s)", err, output)
	}
	cfg := &types.Config{StorageDir: filepath.Dir(source), HLSEnabled: true, HLSCacheDir: t.TempDir(), HLSCacheMaxMB: 128, HLSCacheMaxAgeHours: 72, HLSMaxJobs: 1}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	m, err := newHLSManager(cfg, logger)
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	h := &Handler{config: cfg, hls: m, logger: logger}
	file, err := os.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	id, _, err := m.start(ctx, file, source, info, "480")
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(m.root, id)
	list, err := os.ReadFile(filepath.Join(dir, "index.m3u8"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(list), "chunk_000001/segment_000005.ts") {
		t.Fatal("manifest does not advertise late seek")
	}
	if hlsReady(dir) {
		t.Fatal("transcode must be lazy before the first segment request")
	}
	// Request the final chunk before touching the first one. This simulates a
	// user dragging the native seek bar to an uncached timestamp.
	late := httptest.NewRecorder()
	req := mux.SetURLVars(httptest.NewRequest("GET", "/api/hls/", nil), map[string]string{
		"id": id, "chunk": "chunk_000001", "asset": "segment_000005.ts",
	})
	h.ServeHLS(late, req)
	if late.Code != http.StatusOK {
		t.Fatalf("late seek segment status=%d body=%s", late.Code, late.Body.String())
	}
	if late.Body.Len() == 0 {
		t.Fatal("late segment empty")
	}
	if hlsReady(dir) {
		t.Fatal("random seek unexpectedly transcoded first chunk")
	}
	// Request the start next; it is generated independently.
	early := httptest.NewRecorder()
	req = mux.SetURLVars(httptest.NewRequest("GET", "/api/hls/", nil), map[string]string{
		"id": id, "chunk": "chunk_000000", "asset": "segment_000000.ts",
	})
	h.ServeHLS(early, req)
	if early.Code != http.StatusOK {
		t.Fatalf("first segment status=%d body=%s", early.Code, early.Body.String())
	}
	file2, err := os.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	_, cached, err := m.start(ctx, file2, source, info, "480")
	if err != nil || !cached {
		t.Fatalf("second open should reuse VOD manifest: cached=%v err=%v", cached, err)
	}
}
