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
		jobs: make(map[string]*hlsJob),
	}
}

func testHLSCache(t *testing.T, manager *hlsManager, id string, bytes int, accessed time.Time, complete bool) string {
	t.Helper()
	dir := filepath.Join(manager.root, id)
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	playlist := "#EXTM3U\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXTINF:4,\nsegment_000000.ts\n"
	if complete {
		playlist += "#EXT-X-ENDLIST\n"
	}
	if err := os.WriteFile(filepath.Join(dir, "index.m3u8"), []byte(playlist), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "segment_000000.ts"), make([]byte, bytes), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(dir, accessed, accessed); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestHLSCacheEvictsOldestWithinQuota(t *testing.T) {
	m := testHLSManager(t, 350)
	now := time.Now()
	old := testHLSCache(t, m, strings.Repeat("a", 64), 200, now.Add(-5*time.Hour), true)
	newer := testHLSCache(t, m, strings.Repeat("b", 64), 200, now.Add(-3*time.Hour), true)
	m.prune()
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("oldest cache entry not evicted: %v", err)
	}
	if _, err := os.Stat(newer); err != nil {
		t.Fatalf("newer cache entry evicted unexpectedly: %v", err)
	}
}

func TestHLSCacheRemovesInterruptedAndExpiredEntries(t *testing.T) {
	m := testHLSManager(t, 1<<20)
	interrupted := testHLSCache(t, m, strings.Repeat("c", 64), 200, time.Now(), false)
	expired := testHLSCache(t, m, strings.Repeat("d", 64), 200, time.Now().Add(-96*time.Hour), true)
	untouched := filepath.Join(m.root, "unrelated")
	if err := os.Mkdir(untouched, 0700); err != nil {
		t.Fatal(err)
	}
	m.prune()
	for _, path := range []string{interrupted, expired} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("%s was not cleaned: %v", path, err)
		}
	}
	if _, err := os.Stat(untouched); err != nil {
		t.Fatalf("cleaner touched unrelated directory: %v", err)
	}
}

func TestHLSCacheProtectsActiveJobUntilCapacity(t *testing.T) {
	m := testHLSManager(t, 100)
	id := strings.Repeat("e", 64)
	dir := testHLSCache(t, m, id, 200, time.Now().Add(-time.Hour), false)
	ctx, cancel := context.WithCancel(context.Background())
	m.jobs[id] = &hlsJob{dir: dir, running: true, cancel: cancel, ready: make(chan struct{})}
	m.prune()
	if ctx.Err() != context.Canceled {
		t.Fatal("oversized live conversion must be cancelled")
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("active output must be left for its worker to remove: %v", err)
	}
}

func TestHLSAssetValidationAndHeaders(t *testing.T) {
	m := testHLSManager(t, 1<<20)
	id := strings.Repeat("f", 64)
	testHLSCache(t, m, id, 200, time.Now(), true)
	h := &Handler{hls: m}
	for _, test := range []struct {
		asset string
		code  int
		mime  string
	}{
		{"index.m3u8", http.StatusOK, "application/vnd.apple.mpegurl"},
		{"segment_000000.ts", http.StatusOK, "video/mp2t"},
		{"../private", http.StatusNotFound, ""},
		{"segment_000000.ts.tmp", http.StatusNotFound, ""},
	} {
		req := httptest.NewRequest(http.MethodGet, "/api/hls/"+id+"/"+test.asset, nil)
		req = mux.SetURLVars(req, map[string]string{"id": id, "asset": test.asset})
		rec := httptest.NewRecorder()
		h.ServeHLS(rec, req)
		if rec.Code != test.code {
			t.Errorf("GET %q: got %d, want %d", test.asset, rec.Code, test.code)
		}
		if test.mime != "" && rec.Header().Get("Content-Type") != test.mime {
			t.Errorf("GET %q: unexpected MIME type %q", test.asset, rec.Header().Get("Content-Type"))
		}
	}
}

func TestHLSCanBeginBeforeFullTranscodeFinishes(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg is not installed")
	}
	source := filepath.Join(t.TempDir(), "video.mp4")
	generate := exec.Command("ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
		"-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10", "-t", "12",
		"-c:v", "mpeg4", "-y", source)
	if output, err := generate.CombinedOutput(); err != nil {
		t.Skipf("fixture codec unavailable: %v: %s", err, output)
	}
	cfg := &types.Config{HLSEnabled: true, HLSCacheDir: t.TempDir(),
		HLSCacheMaxMB: 128, HLSCacheMaxAgeHours: 72, HLSMaxJobs: 1}
	m, err := newHLSManager(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	defer m.Close()
	file, err := os.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	id, _, err := m.start(ctx, file, source, info, "480")
	if err != nil {
		t.Fatal(err)
	}
	if !hlsReady(filepath.Join(m.root, id)) {
		t.Fatal("first segment and playlist must be served while transcoding")
	}
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) && !hlsComplete(filepath.Join(m.root, id)) {
		time.Sleep(100 * time.Millisecond)
	}
	if !hlsComplete(filepath.Join(m.root, id)) {
		t.Fatal("ffmpeg did not finish producing a complete playlist")
	}
	file2, err := os.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	_, cached, err := m.start(ctx, file2, source, info, "480")
	if err != nil || !cached {
		t.Fatalf("completed HLS should be reused: cached=%v, err=%v", cached, err)
	}
}
