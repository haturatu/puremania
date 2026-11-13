# On-demand HLS playback

Pure Mania keeps its existing direct-file `http.ServeContent` playback. The video
dialog also offers **720p HLS** and **480p HLS** when FFmpeg is available. These
options are opt-in per playback: choosing Original does not transcode anything.

## How it works

1. The browser POSTs `{"path":"/Videos/example.mp4","quality":"480"}`
   to `/api/hls/start`. FFprobe reads the original duration and the server
   publishes a *complete, seekable VOD playlist* immediately.
2. The browser fetches only the requested 4-second segments. Missing segments
   trigger a 16-second FFmpeg conversion group, with no need to transcode the
   whole video first. Once the requested segment is written atomically, the
   HTTP request can finish while later segments are still being produced.
3. The native seek bar works over the **full video duration**. Seeking to an
   uncached timestamp triggers conversion from the nearest 16-second group,
   not a sequential decode from the start of the movie. Groups are separated
   by HLS discontinuity tags to account for independently generated timestamps.
4. While a viewer requests a segment, the needed group gets priority.
   Interactive conversions can use up to 8 CPU threads (bounded by detected
   CPU count). Optional lookahead uses one thread; an interactive seek can
   cancel lookahead to reclaim its worker slot. Idle sessions do not run
   unbounded background conversion.
5. The quality selection is saved in the browser's `localStorage` as
   `puremania.video.quality`. Opening the next video restores the last
   selected **Original / 720p / 480p** choice. If HLS is unavailable, the
   player falls back to Original without changing the saved choice.

This version offers **manual renditions**, not multivariant adaptive-bitrate
switching between 720p and 480p. Seeking to an uncached location may pause
briefly while FFmpeg generates the requested 4-second segment. Already created
segments are reused from disk, including after a restart with persistent
storage.

## Disk and CPU limits

| Variable | Default | Meaning |
|---|---|---|
| `HLS_ENABLED` | `true` | Enable HLS when FFmpeg is installed |
| `HLS_CACHE_DIR` | user cache dir/`puremania/hls` | Private persistent cache path |
| `HLS_CACHE_MAX_MB` | `2048` | Global cache size ceiling in MiB (128–102400) |
| `HLS_CACHE_MAX_AGE_HOURS` | `72` | Inactivity expiry (1–8760 hours) |
| `HLS_MAX_JOBS` | `1` | Simultaneous transcode limit (1–4) |

The cache is best-effort bounded with a periodic sweep (every two seconds).
It removes stale incomplete segment groups, expires idle video entries, and
evicts least-recently-used **completed 16-second groups** instead of entire
movies. This means a multi-hour source does not require an equally large disk
cache, and previously evicted segments can be generated again when seeking.
If only active, incomplete groups remain and the cache exceeds its budget,
those conversions are cancelled. Generated data can transiently exceed the
quota between sweeps; enforce an additional filesystem quota for strict limits.

The cache key includes a version, absolute source path, file size,
nanosecond mtime and quality. Cache data never modifies originals. Only
hex-identified directories managed by HLS are removed by the cleaner.
If FFmpeg or FFprobe is absent, Pure Mania disables HLS and keeps direct playback.

**Do not point `HLS_CACHE_DIR` at a directory containing unrelated files or
a publicly served directory.** In Docker, the supplied Compose config uses
`/data/hls`, backed by the persistent `puremania-data` volume; deleting the
container does not delete the cache, while deleting its volume does.

## Deploy and troubleshoot

For Docker:

```sh
docker compose --env-file .env.docker up -d --build
```

For an existing binary, install FFmpeg with the H.264 `libx264` and AAC
encoders **and FFprobe**, set the environment variables, and restart Pure Mania. The optional
`HLS_CACHE_DIR` must be writable by the process user and have enough free
space. The default cache directory is created with owner-only permissions.

Diagnostics:

```sh
curl -s http://localhost:8844/api/config
curl -s -H 'Content-Type: application/json' \
  -d '{"path":"/Videos/example.mp4","quality":"480"}' \
  http://localhost:8844/api/hls/start
```

A successful response contains a playlist URL. The playlist is served as
`application/vnd.apple.mpegurl` and segments as `video/mp2t`. Check HTTP
206 responses on the original endpoint separately when debugging Range
requests.

HLS reduces bandwidth by re-encoding video, at the cost of CPU, temporary
disk usage and initial startup delay. It cannot fix an upstream storage
bottleneck or a network slower than the selected rendition. Default 480p
targets about 1 Mbps video plus 96 kbps audio; 720p targets about 2.4 Mbps
video plus 96 kbps audio. Long videos reuse a bounded number of cached 16-second groups. For reliable
playback on a slow CPU or storage device, consider increasing the cache quota
or switching to the Original quality.
