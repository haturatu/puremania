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
 "math"
 "net/http"
 "os"
 "os/exec"
 "path/filepath"
 "regexp"
 "runtime"
 "sort"
 "strconv"
 "strings"
 "sync"
 "time"

 "github.com/gorilla/mux"
 "puremania/internal/types"
)

const (
 hlsSegmentDuration = 4
 hlsChunkSegments = 4
 hlsChunkSeconds = hlsSegmentDuration * hlsChunkSegments
 hlsSegmentWait = 90 * time.Second
 hlsViewerTTL = 20 * time.Second
 hlsMaxDuration = 24 * time.Hour
)

var (
 hlsIDPattern = regexp.MustCompile("^[a-f0-9]{64}$")
 hlsChunkPattern = regexp.MustCompile("^chunk_([0-9]{6})$")
 hlsSegmentPattern = regexp.MustCompile("^segment_([0-9]{6})\\.ts$")
)

// An HLS rendition exposes a complete, seekable VOD timeline from the start.
// Its 4-second segments are produced on demand in 16-second groups; grouping
// amortizes FFmpeg startup without requiring a full-video transcode.
type hlsStream struct {
 id string
 dir string
 source string
 quality string
 size int64
 modified int64
 duration float64
 segmentCount int
 lastViewed time.Time
}

type hlsChunkJob struct {
 key string
 dir string
 cancel context.CancelFunc
 done chan struct{}
 err error
 urgent bool
 acquired bool
}

type hlsManager struct {
 root string
 maxBytes int64
 maxAge time.Duration
 ffmpeg string
 ffprobe string
 logger *slog.Logger
 slots chan struct{}
 ctx context.Context
 cancel context.CancelFunc
 mu sync.Mutex
 streams map[string]*hlsStream
 jobs map[string]*hlsChunkJob
 urgentWaiting int
 closed bool
}

func newHLSManager(cfg *types.Config, logger *slog.Logger) (*hlsManager,error) {
 if !cfg.HLSEnabled { return nil,nil }
 ffmpeg,err:=exec.LookPath("ffmpeg"); if err!=nil { return nil,fmt.Errorf("HLS requires ffmpeg: %w",err) }
 ffprobe,err:=exec.LookPath("ffprobe"); if err!=nil { return nil,fmt.Errorf("HLS seeking requires ffprobe: %w",err) }
 root,err:=filepath.Abs(cfg.HLSCacheDir); if err!=nil { return nil,err }
 if err=os.MkdirAll(root,0700); err!=nil { return nil,err }
 info,err:=os.Lstat(root)
 if err!=nil || !info.IsDir() || info.Mode()&os.ModeSymlink!=0 { return nil,errors.New("invalid HLS cache directory") }
 ctx,cancel:=context.WithCancel(context.Background())
 m:=&hlsManager{
  root:root, maxBytes:cfg.HLSCacheMaxMB<<20, maxAge:time.Duration(cfg.HLSCacheMaxAgeHours)*time.Hour,
  ffmpeg:ffmpeg,ffprobe:ffprobe,logger:logger,slots:make(chan struct{},cfg.HLSMaxJobs),
  ctx:ctx,cancel:cancel,streams:make(map[string]*hlsStream),jobs:make(map[string]*hlsChunkJob),
 }
 m.prune()
 go m.maintenance()
 return m,nil
}

func (m *hlsManager) Close() {
 m.mu.Lock()
 m.closed=true
 m.cancel()
 for _,job:=range m.jobs { job.cancel() }
 m.mu.Unlock()
}

func (m *hlsManager) maintenance() {
 ticker:=time.NewTicker(2*time.Second); defer ticker.Stop()
 for {
  select {
  case <-m.ctx.Done(): return
  case <-ticker.C: m.prune()
  }
 }
}

func hlsID(source string,info os.FileInfo,quality string) string {
 key:=fmt.Sprintf("hls-v2\x00%s\x00%d\x00%d\x00%s",source,info.Size(),info.ModTime().UnixNano(),quality)
 digest:=sha256.Sum256([]byte(key))
 return hex.EncodeToString(digest[:])
}

func (m *hlsManager) probeDuration(ctx context.Context,file *os.File,source string) (float64,error) {
 input,extras:=childProcessFilePath(file,source)
 probeCtx,cancel:=context.WithTimeout(ctx,15*time.Second); defer cancel()
 cmd:=exec.CommandContext(probeCtx,m.ffprobe,"-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",input)
 cmd.ExtraFiles=extras
 output,err:=cmd.Output(); if err!=nil { return 0,fmt.Errorf("ffprobe: %w",err) }
 duration,err:=strconv.ParseFloat(strings.TrimSpace(string(output)),64)
 if err!=nil || math.IsNaN(duration) || math.IsInf(duration,0) || duration<=0 || duration>hlsMaxDuration.Seconds() {
  return 0,errors.New("unsupported video duration")
 }
 return duration,nil
}

// Build a complete VOD index immediately. The player can seek to any
// timestamp and request just the corresponding chunk from the server.
// Each independently started FFmpeg group has a timestamp discontinuity.
func hlsPlaylist(duration float64) string {
 count:=int(math.Ceil(duration/hlsSegmentDuration))
 var b strings.Builder
 b.Grow(count*90+256)
 b.WriteString("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-MEDIA-SEQUENCE:0\n")
 for i:=0;i<count;i++ {
  if i>0 && i%hlsChunkSegments==0 { b.WriteString("#EXT-X-DISCONTINUITY\n") }
  segmentSeconds:=math.Min(hlsSegmentDuration,duration-float64(i*hlsSegmentDuration))
  if segmentSeconds<=0 { segmentSeconds=0.001 }
  fmt.Fprintf(&b,"#EXTINF:%.3f,\nchunk_%06d/segment_%06d.ts\n",segmentSeconds,i/hlsChunkSegments,i)
 }
 b.WriteString("#EXT-X-ENDLIST\n")
 return b.String()
}

func (m *hlsManager) start(ctx context.Context,file *os.File,source string,info os.FileInfo,quality string) (string,bool,error) {
 defer func(){ _=file.Close() }()
 if quality!="720" && quality!="480" { return "",false,errors.New("invalid HLS quality") }
 duration,err:=m.probeDuration(ctx,file,source); if err!=nil { return "",false,err }
 m.prune()
 id:=hlsID(source,info,quality)
 m.mu.Lock()
 defer m.mu.Unlock()
 if m.closed { return "",false,errors.New("HLS service is shutting down") }
 if stream,ok:=m.streams[id];ok {
  stream.lastViewed=time.Now()
  m.touch(stream.dir)
  return id,true,nil
 }
 dir:=filepath.Join(m.root,id)
 _,statErr:=os.Stat(filepath.Join(dir,"index.m3u8"))
 cached:=statErr==nil
 if err:=os.MkdirAll(dir,0700); err!=nil { return "",false,err }
 playlist:=hlsPlaylist(duration)
 // Publish atomically so HLS clients never observe partial manifests.
 tmp,err:=os.CreateTemp(dir,".playlist-*")
 if err!=nil { return "",false,err }
 _,writeErr:=io.WriteString(tmp,playlist)
 if writeErr==nil { writeErr=tmp.Close() }else{ _=tmp.Close() }
 if writeErr==nil { writeErr=os.Rename(tmp.Name(),filepath.Join(dir,"index.m3u8")) }
 if writeErr!=nil { _=os.Remove(tmp.Name());return "",false,writeErr }
 m.streams[id]=&hlsStream{id:id,dir:dir,source:source,quality:quality,size:info.Size(),modified:info.ModTime().UnixNano(),duration:duration,segmentCount:int(math.Ceil(duration/hlsSegmentDuration)),lastViewed:time.Now()}
 m.touch(dir)
 return id,cached,nil
}

func (m *hlsManager) touch(dir string) {
 now:=time.Now(); _=os.Chtimes(dir,now,now)
}

// Completed 16-second groups are reusable across sessions and restarts.
func hlsChunkComplete(dir string) bool {
 info,err:=os.Stat(filepath.Join(dir,".complete"))
 return err==nil && info.Mode().IsRegular()
}
func hlsReady(dir string) bool {
 _,err:=os.Stat(filepath.Join(dir,"chunk_000000","segment_000000.ts"))
 return err==nil
}
func hlsComplete(dir string) bool {
 files,err:=os.ReadDir(dir); if err!=nil { return false }
 if _,err=os.Stat(filepath.Join(dir,"index.m3u8"));err!=nil{return false}
 for _,entry:=range files {
  if hlsChunkPattern.MatchString(entry.Name()) && entry.IsDir() && !hlsChunkComplete(filepath.Join(dir,entry.Name())) { return false }
 }
 return true
}

func hlsChunkName(chunk int) string { return fmt.Sprintf("chunk_%06d",chunk) }
func hlsSegmentName(segment int) string { return fmt.Sprintf("segment_%06d.ts",segment) }

func (m *hlsManager) noteViewer(id string) {
 m.mu.Lock()
 if stream:=m.streams[id];stream!=nil { stream.lastViewed=time.Now() }
 m.mu.Unlock()
}

func (m *hlsManager) startChunk(stream *hlsStream,chunk int,urgent bool,open func(string)(*os.File,error)) *hlsChunkJob {
 dir:=filepath.Join(stream.dir,hlsChunkName(chunk))
 key:=stream.id+":"+strconv.Itoa(chunk)
 m.mu.Lock()
 defer m.mu.Unlock()
 if job:=m.jobs[key];job!=nil {
  if urgent && !job.urgent {
   job.urgent=true
   if !job.acquired {m.urgentWaiting++}
  }
  return job
 }
 if hlsChunkComplete(dir) { return nil }
 if m.closed { return &hlsChunkJob{done:closedHLSDone(),err:context.Canceled} }
 // A preceding crashed transcode may have left partial segments.
 _=os.RemoveAll(dir)
 if err:=os.MkdirAll(dir,0700);err!=nil { return &hlsChunkJob{done:closedHLSDone(),err:err} }
 ctx,cancel:=context.WithCancel(m.ctx)
 job:=&hlsChunkJob{key:key,dir:dir,cancel:cancel,done:make(chan struct{}),urgent:urgent}
 m.jobs[key]=job
 if urgent {
  m.urgentWaiting++
  // Interactive seeks preempt background lookahead, not other viewers.
  for _,other:=range m.jobs {
   if other!=job && !other.urgent && other.acquired { other.cancel() }
  }
 }
 go m.encodeChunk(ctx,job,stream,chunk,open)
 return job
}

func closedHLSDone() chan struct{} { done:=make(chan struct{});close(done);return done }

func (m *hlsManager) acquire(ctx context.Context,job *hlsChunkJob) bool {
 ticker:=time.NewTicker(100*time.Millisecond);defer ticker.Stop()
 for {
  m.mu.Lock()
  allowed:=job.urgent || m.urgentWaiting==0
  if allowed {
   select {
   case m.slots<-struct{}{}:
    job.acquired=true
    if job.urgent && m.urgentWaiting>0 { m.urgentWaiting-- }
    m.mu.Unlock()
    return true
   default:
   }
  }
  m.mu.Unlock()
  select {
  case <-ctx.Done(): return false
  case <-ticker.C:
  }
 }
}

func (m *hlsManager) encodeChunk(ctx context.Context,job *hlsChunkJob,stream *hlsStream,chunk int,open func(string)(*os.File,error)) {
 err:=m.runChunk(ctx,job,stream,chunk,open)
 m.mu.Lock()
 if job.urgent && !job.acquired && m.urgentWaiting>0 { m.urgentWaiting-- }
 if job.acquired { <-m.slots }
 job.err=err
 delete(m.jobs,job.key)
 close(job.done)
 m.mu.Unlock()
 if err!=nil {
  _=os.RemoveAll(job.dir)
  if !errors.Is(err,context.Canceled) { m.logger.Warn("HLS chunk failed","chunk",chunk,"error",err) }
 }else if chunk+1<int(math.Ceil(float64(stream.segmentCount)/hlsChunkSegments)) {
  m.mu.Lock()
  recent:=time.Since(stream.lastViewed)<hlsViewerTTL
  m.mu.Unlock()
  if recent { m.startChunk(stream,chunk+1,false,open) }
 }
}

func (m *hlsManager) runChunk(ctx context.Context,job *hlsChunkJob,stream *hlsStream,chunk int,open func(string)(*os.File,error)) error {
 if !m.acquire(ctx,job) { return ctx.Err() }
 file,err:=open(stream.source);if err!=nil{return err}
 defer func(){ _=file.Close() }()
 info,err:=file.Stat()
 if err!=nil || info.Size()!=stream.size || info.ModTime().UnixNano()!=stream.modified { return errors.New("source video changed during transcode") }
 input,extras:=childProcessFilePath(file,stream.source)
 height,width,rate,buffer:="720","1280","2400k","4800k"
 if stream.quality=="480" { height,width,rate,buffer="480","854","1000k","2000k" }
 filter:=fmt.Sprintf("scale=w='min(%s,iw)':h='min(%s,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",width,height)
 m.mu.Lock();interactive:=job.urgent;m.mu.Unlock()
 threads:=1
 if interactive { threads=runtime.NumCPU();if threads>8{threads=8};if threads<1{threads=1} }
 offset:=float64(chunk*hlsChunkSeconds)
 length:=math.Min(hlsChunkSeconds,stream.duration-offset)
 if length<=0 { return errors.New("chunk beyond video duration") }
 first:=chunk*hlsChunkSegments
 args:=[]string{
  "-nostdin","-hide_banner","-loglevel","error",
  "-ss",strconv.FormatFloat(offset,'f',3,64),
  "-i",input,
  "-t",strconv.FormatFloat(length,'f',3,64),
  "-map","0:v:0","-map","0:a:0?",
  "-threads",strconv.Itoa(threads),"-vf",filter,
  "-c:v","libx264","-preset","veryfast","-b:v",rate,"-maxrate",rate,"-bufsize",buffer,
  "-pix_fmt","yuv420p","-force_key_frames","expr:gte(t,n_forced*4)","-sc_threshold","0",
  "-c:a","aac","-b:a","96k",
  "-f","hls","-hls_time","4","-hls_list_size","0",
  "-hls_start_number_source","generic","-start_number",strconv.Itoa(first),
  "-hls_flags","temp_file+independent_segments",
  "-hls_segment_filename",filepath.Join(job.dir,"segment_%06d.ts"),
  filepath.Join(job.dir,".generated.m3u8"),
 }
 cmd:=exec.CommandContext(ctx,m.ffmpeg,args...);cmd.ExtraFiles=extras
 var output limitedHLSLog;cmd.Stderr=&output
 if err:=cmd.Run();err!=nil { return fmt.Errorf("%w (%s)",err,output.String()) }
 for segment:=first;segment<first+hlsChunkSegments && segment<stream.segmentCount;segment++ {
  info,err:=os.Stat(filepath.Join(job.dir,hlsSegmentName(segment)))
  if err!=nil || !info.Mode().IsRegular() { return fmt.Errorf("missing generated HLS segment %d",segment) }
 }
 return os.WriteFile(filepath.Join(job.dir,".complete"),[]byte("ok\n"),0600)
}

type limitedHLSLog struct{ data []byte }
func (b *limitedHLSLog) Write(p []byte)(int,error){
 if len(b.data)<8192 {
  limit:=8192-len(b.data);if len(p)<limit{limit=len(p)}
  b.data=append(b.data,p[:limit]...)
 }
 return len(p),nil
}
func (b *limitedHLSLog) String()string{return string(b.data)}

func (m *hlsManager) waitSegment(ctx context.Context,stream *hlsStream,chunk,segment int,open func(string)(*os.File,error))error{
 dir:=filepath.Join(stream.dir,hlsChunkName(chunk))
 path:=filepath.Join(dir,hlsSegmentName(segment))
 job:=m.startChunk(stream,chunk,true,open)
 timeout,cancel:=context.WithTimeout(ctx,hlsSegmentWait);defer cancel()
 ticker:=time.NewTicker(100*time.Millisecond);defer ticker.Stop()
 for {
  if stat,err:=os.Stat(path);err==nil && stat.Mode().IsRegular(){ return nil }
  if job!=nil {
   select {
   case <-job.done:
    if job.err!=nil{return job.err}
    return errors.New("HLS segment not generated")
   default:
   }
  }else{return errors.New("HLS cache segment missing")}
  select {
  case <-timeout.Done(): return timeout.Err()
  case <-ticker.C:
  }
 }
}

// Cleanup owns only SHA-256-named cache entries, removing expired/incomplete
// conversions and evicting least-recently-used content. Active encodes are
// cancelled if the remaining cache alone exceeds the configured limit.
func (m *hlsManager) prune() {
 m.mu.Lock()
 defer m.mu.Unlock()
 roots,err:=os.ReadDir(m.root);if err!=nil{return}
 now:=time.Now()
 type entry struct{path string;modified time.Time;bytes int64;recent bool}
 var completed []entry
 var total int64
 for _,root:=range roots{
  id:=root.Name()
  if !root.IsDir() || !hlsIDPattern.MatchString(id){continue}
  dir:=filepath.Join(m.root,id)
  info,err:=root.Info();if err!=nil{continue}
  // Remove expired videos only when no FFmpeg job is still using their files.
  active:=false
  for key:=range m.jobs{if strings.HasPrefix(key,id+":"){active=true;break}}
  if !active && now.Sub(info.ModTime())>m.maxAge{
   _=os.RemoveAll(dir);delete(m.streams,id);continue
  }
  files,err:=os.ReadDir(dir);if err!=nil{continue}
  for _,child:=range files{
   if child.IsDir() && hlsChunkPattern.MatchString(child.Name()){
    group:=filepath.Join(dir,child.Name())
    chunkID,_:=strconv.Atoi(strings.TrimPrefix(child.Name(),"chunk_"))
    busy:=m.jobs[id+":"+strconv.Itoa(chunkID)]!=nil
    groupInfo,infoErr:=child.Info()
    if infoErr!=nil{continue}
    if !busy && !hlsChunkComplete(group) && now.Sub(groupInfo.ModTime())>5*time.Minute{
     // A dead ffmpeg left an incomplete segment group.
     _=os.RemoveAll(group);continue
    }
    bytes:=hlsDirectoryBytes(group)
    total+=bytes
    if !busy && hlsChunkComplete(group){
     completed=append(completed,entry{group,groupInfo.ModTime(),bytes,now.Sub(groupInfo.ModTime())<hlsViewerTTL})
    }
   }else if child.Type().IsRegular(){
    if info,err:=child.Info();err==nil{total+=info.Size()}
   }
  }
 }
 // Evict completed segment groups rather than whole videos. This allows a
 // multi-hour movie to remain seekable with a small fixed cache budget.
 sort.Slice(completed,func(i,j int)bool{
  if completed[i].recent!=completed[j].recent{return !completed[i].recent}
  return completed[i].modified.Before(completed[j].modified)
 })
 for _,group:=range completed{
  if total<=m.maxBytes{break}
  if err:=os.RemoveAll(group.path);err==nil{total-=group.bytes}
 }
 if total>m.maxBytes {
  // Only in-flight, unfinished segments remain. Cancel instead of allowing
  // the cache to grow without limit; direct playback still works.
  for _,job:=range m.jobs{job.cancel()}
 }
}
func hlsDirectoryBytes(dir string)int64{
 var size int64
 _=filepath.WalkDir(dir,func(_ string,e os.DirEntry,err error)error{
  if err==nil && e.Type().IsRegular(){if info,e:=e.Info();e==nil{size+=info.Size()}}
  return nil
 })
 return size
}

func (h *Handler) StartHLS(w http.ResponseWriter,r *http.Request){
 if h.hls==nil {h.respondError(w,"HLS disabled or ffmpeg/ffprobe unavailable",http.StatusServiceUnavailable);return}
 var input struct{ Path string `json:"path"`; Quality string `json:"quality"` }
 if json.NewDecoder(io.LimitReader(r.Body,16<<10)).Decode(&input)!=nil{h.respondError(w,"Invalid JSON",http.StatusBadRequest);return}
 if input.Quality==""{input.Quality="720"}
 if input.Quality!="720" && input.Quality!="480"{h.respondError(w,"Unsupported quality",http.StatusBadRequest);return}
 path,err:=h.convertToPhysicalPath(input.Path);if err!=nil||input.Path==""{h.respondError(w,"Invalid path",http.StatusBadRequest);return}
 file,err:=h.openAllowedPath(path,os.O_RDONLY,0);if err!=nil{h.respondError(w,"Cannot open video",http.StatusNotFound);return}
 info,err:=file.Stat()
 if err!=nil || !info.Mode().IsRegular() || !strings.HasPrefix(mediaTypeByPath(input.Path),"video/"){
  _=file.Close();h.respondError(w,"Not a regular video",http.StatusBadRequest);return
 }
 id,cached,err:=h.hls.start(r.Context(),file,path,info,input.Quality)
 if err!=nil{h.logger.Warn("HLS startup failed","error",err);h.respondError(w,"Cannot prepare HLS video",http.StatusServiceUnavailable);return}
 w.Header().Set("Cache-Control","no-store")
 h.respondSuccess(w,map[string]interface{}{"url":"/api/hls/"+id+"/index.m3u8","cached":cached,"quality":input.Quality})
}

func (h *Handler) ServeHLS(w http.ResponseWriter,r *http.Request){
 if h.hls==nil{http.NotFound(w,r);return}
 v:=mux.Vars(r);id:=v["id"];asset:=v["asset"];chunkName:=v["chunk"]
 if !hlsIDPattern.MatchString(id) {http.NotFound(w,r);return}
 m:=h.hls
 m.mu.Lock();stream:=m.streams[id];m.mu.Unlock()
 if stream==nil{http.NotFound(w,r);return}
 path:=filepath.Join(stream.dir,"index.m3u8")
 if chunkName!=""{
  chunkMatch:=hlsChunkPattern.FindStringSubmatch(chunkName)
  segmentMatch:=hlsSegmentPattern.FindStringSubmatch(asset)
  if chunkMatch==nil || segmentMatch==nil{http.NotFound(w,r);return}
  chunk,_:=strconv.Atoi(chunkMatch[1]);segment,_:=strconv.Atoi(segmentMatch[1])
  if segment>=stream.segmentCount || chunk!=segment/hlsChunkSegments{http.NotFound(w,r);return}
  m.noteViewer(id)
  if err:=m.waitSegment(r.Context(),stream,chunk,segment,h.openAllowedPathForHLS);err!=nil{
   h.logger.Warn("HLS segment unavailable","error",err)
   http.Error(w,"HLS segment not yet available",http.StatusServiceUnavailable);return
  }
  path=filepath.Join(stream.dir,chunkName,asset)
 }else if asset!="index.m3u8"{http.NotFound(w,r);return}
 file,err:=os.Open(path);if err!=nil{http.NotFound(w,r);return}
 defer func(){_=file.Close()}()
 info,err:=file.Stat();if err!=nil || !info.Mode().IsRegular(){http.NotFound(w,r);return}
 m.touch(stream.dir)
 w.Header().Set("X-Content-Type-Options","nosniff")
 if chunkName==""{
  w.Header().Set("Content-Type","application/vnd.apple.mpegurl")
  w.Header().Set("Cache-Control","private, no-cache")
 }else{
  w.Header().Set("Content-Type","video/mp2t")
  w.Header().Set("Cache-Control","private, max-age=3600")
 }
 http.ServeContent(w,r,asset,info.ModTime(),file)
}

func (h *Handler) openAllowedPathForHLS(path string)(*os.File,error){
 return h.openAllowedPath(path,os.O_RDONLY,0)
}
