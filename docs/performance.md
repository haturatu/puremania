# Binary performance investigation

Investigated on 2026-10-24. The production-code baseline is `b7c9a1b`;
`8117807` adds only the benchmarks and is the reproducible baseline checkout.
The changes target directory listing CPU/allocations and HTTP compression.

## Investigation and implementation plan

1. Build the current backend, inspect its symbols/disassembly, and establish
   repeated allocation/time benchmarks plus CPU/heap profiles.
2. Replace repeated name normalization and full `FileInfo` sorting with a
   compact sort index; preserve all sort directions, tie ordering, and cache
   immutability.
3. Remove redundant directory sorting and per-entry generic formatting during
   ETag generation, preserving the existing hash input bytes.
4. Reuse gzip/Brotli writers at the existing compression levels, detaching
   response state on normal completion, write failure, and panic.
5. Repeat measurements, verify compatibility/concurrency, and submit a PR.

## Binary and profile evidence

The existing ignored `./puremania` executable was built with Go 1.26.5 from
`6e37d1e` with local modifications. It is older than the checkout and was not
used for before/after comparisons. Both investigation executables were rebuilt
with Go 1.27.3, `CGO_ENABLED=0`, and the same default optimization settings;
debug symbols were kept for inspection. No `-N`, `-l`, PGO, architecture changes,
or compression-level changes were introduced.

`go tool nm -size -sort size` showed large runtime/dependency symbols, but symbol
size alone does not establish a runtime bottleneck. Disassembly and measured
profiles identified these actionable costs:

| Path | Baseline binary/profile observation | Change |
| --- | --- | --- |
| Paginated directory sort | Comparator contains two `CALL strings.ToLower`; 30,000 mixed-case names cause about 1.24 million allocations/page. `strings.ToLower` accounts for 57.24% cumulative sampled CPU in the isolated name-sort run. Reflective stable sorting also copies/swaps complete file records. | Normalize once per file; sort `{index, key}` entries with `slices.SortFunc`; copy only the requested page. Original index breaks exact ties to preserve stable ordering. |
| Directory ETag | `os.ReadDir` already sorts names, followed by another `sort.Slice`. The entry loop calls `runtime.convTstring`, `runtime.convT64`, and `fmt.Fprintf`. | Use the existing `os.ReadDir` order and a reusable byte buffer with `strconv.AppendInt`. Keep the name/size/nanosecond timestamp encoding, mount order, and MD5 digest unchanged. |
| Response compression | Every textual response creates a compressor. Heap profiles attribute most allocations to gzip/flate and Brotli encoder initialization/buffers, totaling about 1 MiB per 32 KiB response. | Separate `sync.Pool`s for gzip and Brotli, preserving gzip default/Brotli level 4. Reset writers before use and before returning them; defer release so failed/panicking handlers cannot retain the response destination. |

After rebuilding, name normalization appears in the index-building loop and
not in the comparator. The state-key entry-writing helper calls
`strconv.AppendInt` instead of `fmt.Fprintf`; the extra entry sort is gone.
The compression start path acquires writers from pools and calls `Reset`.
Pools may allocate again after GC or a concurrency increase; this is not a
zero-allocation guarantee.

Representative disassembly calls (addresses omitted because builds differ):

```text
before: servePaginatedFileList.func1 -> strings.ToLower (twice)
after:  sortedFilePage             -> strings.ToLower (index-building loop)
        sortedFilePage.func1       -> no strings.ToLower calls
before: generateDirectoryStateKey  -> sort.Slice, fmt.Fprintf, runtime.convT64
after:  state-key entry helper     -> internal/strconv.AppendInt
before: compression start          -> compress/gzip.NewWriterLevel
after:  compression start          -> sync.(*Pool).Get, writer Reset
```

The unstripped ELF grew from 16,978,086 to 16,995,619 bytes (+17,533 bytes,
0.10%); `size` reports text increasing by 13,272 bytes and unchanged BSS.
This is a runtime CPU/allocation optimization, not an executable-size reduction.

## Measurements

Environment: Linux amd64, AMD Ryzen 5 PRO 3500U, Go
`go1.27.3-X:nodwarf5`, `GOAMD64=v1`. Test executables use the default
`CGO_ENABLED=1`; both sides use the same compiler/environment and
`GOMAXPROCS=4`. Each table cell is the median of six runs with a 500 ms minimum
benchmark duration. Before and after executables ran sequentially with the
same `TMPDIR`; filesystem fixtures were created outside timed loops. Raw
samples: [before](performance/before.txt), [after](performance/after.txt).

| Benchmark | Before ms/op | After ms/op | Speedup | Before B/op | After B/op | Before allocs/op | After allocs/op |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PaginatedFileList/3000/name | 14.202 | 1.101 | 12.90x | 1,886,164 | 156,627 | 96,712 | 3,042 |
| PaginatedFileList/3000/size | 1.169 | 0.643 | 1.82x | 294,870 | 107,184 | 44 | 41 |
| PaginatedFileList/3000/modified | 3.588 | 0.819 | 4.38x | 294,272 | 105,520 | 43 | 41 |
| PaginatedFileList/3000/type | 3.522 | 0.788 | 4.47x | 293,860 | 105,528 | 43 | 41 |
| PaginatedFileList/30000/name | 149.657 | 8.761 | 17.08x | 22,551,848 | 1,234,210 | 1,238,793 | 30,041 |
| PaginatedFileList/30000/size | 23.674 | 7.716 | 3.07x | 2,672,578 | 753,798 | 44 | 41 |
| PaginatedFileList/30000/modified | 47.060 | 10.012 | 4.70x | 2,674,601 | 752,332 | 45 | 41 |
| PaginatedFileList/30000/type | 47.659 | 9.269 | 5.14x | 2,674,326 | 753,018 | 44 | 41 |
| DirectoryStateKey | 11.537 | 10.309 | 1.12x | 1,771,966 | 1,699,962 | 21,082 | 15,078 |
| ListFilesWarm | 22.401 | 11.337 | 1.98x | 3,521,489 | 1,761,233 | 117,790 | 18,132 |
| ResponseCompression/gzip/1024 | 0.341 | 0.013 | 26.65x | 1,077,364 | 1,580 | 30 | 16 |
| ResponseCompression/gzip/32768 | 0.385 | 0.068 | 5.66x | 1,077,856 | 2,044 | 31 | 17 |
| ResponseCompression/br/1024 | 0.240 | 0.027 | 9.01x | 563,558 | 1,274 | 25 | 15 |
| ResponseCompression/br/32768 | 0.341 | 0.041 | 8.25x | 1,061,624 | 1,330 | 25 | 15 |

The paginated benchmark includes cache lookup, sorting, and JSON generation of
100 entries at a middle offset. Its input uses deterministic shuffled,
mixed-case image names. `ListFilesWarm` additionally includes filesystem
revalidation for 3,000 real files. These are handler benchmarks with
`httptest.ResponseRecorder`, not network/browser latency or a cold-storage
throughput measurement. Compression inputs are repetitive synthetic JSON at
the indicated byte lengths; gains vary with content and concurrency.

## Compatibility and validation

- Differential sorting tests cover every supported field, both directions,
  fallback fields, Unicode names, extreme sizes, duplicate paths, empty/end
  pages, and the absence of mutation in the shared cache.
- State-key tests compare against the previous `fmt.Fprintf` encoding,
  including long/Unicode/delimiter-containing filenames, directories, mounts,
  and metadata/size changes.
- Compression tests decode independent sequential and concurrent streams,
  exercise `Flush`/`ReadFrom`, and verify recovery after write failure and panic.
  Existing range, binary-response, negotiation, and header tests remain in use.

Passed locally:

```sh
go test -count=1 ./...
go vet ./...
go test -race -count=1 ./...
go test ./internal/middleware -run=FuzzSelectContentEncoding -fuzz=FuzzSelectContentEncoding -fuzztime=10s -parallel=4
SOAK_DURATION=15s go test ./internal/middleware -run='^TestHTTPSoak$' -count=1 -timeout=1m
npm test
```

The fuzz run completed 243,810 executions; all 70 frontend unit tests passed.
The rebuilt production ELF also passed a live HTTP smoke check with 32
concurrent gzip listings, stable ETags and `304` revalidation, an uncompressed
byte-range download, the healthcheck command, and graceful shutdown. This used
an isolated temporary storage directory and disabled aria2c.
Browser E2E and container build/scan were not run locally.

## Remaining work and limits

- Every listing/revalidation still reads all directory entries and stats each
  entry, even for `304` or a 100-file page. The optimized state-key CPU profile
  spends 68.81% of sampled CPU in `Syscall6`. Directory mtime alone cannot detect
  changes to existing file contents; replacing this with a cheap timestamp
  cache would weaken external-change detection. Filesystem watching or a
  versioned directory index needs a separate consistency design.
- Each non-empty page still builds and sorts an O(N) index. Caching sort orders
  could help repeated pages, but would require bounded memory accounting and
  invalidation across listing states and sort variants.
- Cold listing submits one task per directory entry and appends under a mutex;
  search performs path conversion before checking the name matcher. These are
  source-level follow-up candidates, not measured speedup claims in this PR.
- FFmpeg, archive workloads, upload durability, remote filesystems, browser
  rendering, and production RSS/latency under concurrent load were not measured.
  The benchmark covers up to 30,000 entries, not the README's 300,000-file case.

## Reproduction

Use separate worktrees at `8117807` and the PR head. Keep the same Go toolchain,
filesystem, `TMPDIR`, and CPU setting for both. If `/tmp` is constrained, set
`GOTMPDIR` to a directory on a filesystem that allows executable files.

```sh
go test -c -o /path/to/results/handlers.test ./internal/handlers
go test -c -o /path/to/results/middleware.test ./internal/middleware
/path/to/results/handlers.test -test.run '^$' -test.bench 'Benchmark(PaginatedFileList|DirectoryStateKey|ListFilesWarm)$' -test.benchmem -test.benchtime=500ms -test.count=6 -test.cpu=4
/path/to/results/middleware.test -test.run '^$' -test.bench '^BenchmarkResponseCompression$' -test.benchmem -test.benchtime=500ms -test.count=6 -test.cpu=4

CGO_ENABLED=0 go build -o /path/to/results/puremania ./cmd/puremania
go tool nm -size -sort size /path/to/results/puremania
go tool objdump -s 'puremania/internal/handlers.sortedFilePage' /path/to/results/puremania
go tool objdump -s 'puremania/internal/handlers.\(\*Handler\).generateDirectoryStateKey' /path/to/results/puremania
go tool objdump -s 'puremania/internal/middleware.\(\*compressionResponseWriter\).start' /path/to/results/puremania

go test ./internal/handlers -run '^$' -bench '^BenchmarkPaginatedFileList/30000/name$' -benchtime=3s -cpu=4 -cpuprofile=list.cpu -memprofile=list.mem
go tool pprof -top list.cpu
go tool pprof -top -alloc_space list.mem
go test ./internal/middleware -run '^$' -bench '^BenchmarkResponseCompression/.*/32768$' -benchtime=2s -cpu=4 -cpuprofile=compression.cpu -memprofile=compression.mem
go tool pprof -top -alloc_space compression.mem
```
