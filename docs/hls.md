# On-demand HLS playback

Pure Mania keeps its existing direct-file `http.ServeContent` playback. The video
dialog also offers **720p HLS** and **480p HLS** when FFmpeg is available. These
options are opt-in per playback: choosing Original does not transcode anything.

## How it works

1. The browser POSTs `{"path":"/Videos/example.mp4","quality":"720"}` as
   `application/json` to `/api/hls/start`. This route retains the existing
   CSRF protection and safe file-open checks.
2. A single FFmpeg job for the file+mtime+size+quality identity generates
   four-second MPEG-TS HLS segments and a growing EVENT manifest. Completed
   segments are written atomically before becoming visible.
3. The start request returns when the first manifest and segment are available,
   **not** when the whole video has been converted. The client uses native HLS
   on supported browsers and a locally bundled lazy-loaded hls.js elsewhere.
4. When FFmpeg finishes, the manifest includes `#EXT-X-ENDLIST`. Reopening
   the unchanged video reuses the completed conversion, including after a
   process/container restart when the cache volume persists.

This initial implementation provides **manually selectable** 720p/480p
renditions, not seamless adaptive-bitrate switching between renditions.
While EVENT output is still growing, seeking ahead of the generated region is
not supported. Switching from Original to an uncached rendition restarts from
the beginning. Seek positions are retained when switching to a completed cache.

## Disk and CPU limits

| Variable | Default | Meaning |
|---|---|---|
| `HLS_ENABLED` | `true` | Enable HLS when FFmpeg is installed |
| `HLS_CACHE_DIR` | user cache dir/`puremania/hls` | Private persistent cache path |
| `HLS_CACHE_MAX_MB` | `2048` | Global cache size ceiling in MiB (128–102400) |
| `HLS_CACHE_MAX_AGE_HOURS` | `72` | Inactivity expiry (1–8760 hours) |
| `HLS_MAX_JOBS` | `1` | Simultaneous transcode limit (1–4) |

The cache is best-effort bounded with a periodic sweep (every two seconds).
It deletes incomplete jobs left by server crashes, expires old completed
conversions, and evicts least-recently-used completed conversions when over
quota. Recently accessed completed videos are only evicted when needed for the
quota; active jobs are otherwise protected. If active conversions alone exceed
the budget, they are **cancelled** to prevent unbounded disk growth, and the
player can be switched back to Original. A segment written between sweeps can
temporarily exceed the quota. For a *strict* filesystem-level quota use a
dedicated quota-controlled volume as well.

The cache key includes a version, absolute source path, file size,
nanosecond mtime and quality. Cache data never modifies originals. Only
hex-identified directories managed by HLS are removed by the cleaner.
If FFmpeg is absent, Pure Mania disables HLS and keeps direct playback.

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
encoders, set the environment variables, and restart Pure Mania. The optional
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
video plus 96 kbps audio. Long videos may exceed the configured cache limit:
increase the quota or use Original for videos that cannot fit.
