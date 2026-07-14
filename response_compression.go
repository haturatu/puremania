package main

import (
	"compress/gzip"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/andybalholm/brotli"
)

// responseCompressionMiddleware negotiates a response encoding for textual
// responses. File streams, Range requests, and already-compressed media are
// intentionally left untouched so downloads and resumable uploads retain
// their byte-for-byte and range semantics.
func responseCompressionMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead || r.Header.Get("Range") != "" {
			next.ServeHTTP(w, r)
			return
		}

		encoding := selectContentEncoding(r.Header.Get("Accept-Encoding"))
		if encoding == "" {
			next.ServeHTTP(w, r)
			return
		}

		cw := &compressionResponseWriter{
			ResponseWriter: w,
			encoding:       encoding,
		}
		next.ServeHTTP(cw, r)
		cw.finish()
	})
}

type compressionResponseWriter struct {
	http.ResponseWriter
	encoding string
	status   int
	started  bool
	writer   io.Writer
	closer   io.Closer
}

func (w *compressionResponseWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}

func (w *compressionResponseWriter) Write(data []byte) (int, error) {
	if !w.started {
		w.start()
	}
	return w.writer.Write(data)
}

func (w *compressionResponseWriter) start() {
	w.started = true
	status := w.status
	if status == 0 {
		status = http.StatusOK
	}

	if w.shouldCompress(status) {
		header := w.Header()
		header.Del("Content-Length")
		header.Set("Content-Encoding", w.encoding)
		header.Add("Vary", "Accept-Encoding")
		switch w.encoding {
		case "br":
			writer := brotli.NewWriterLevel(w.ResponseWriter, 4)
			w.writer, w.closer = writer, writer
		case "gzip":
			writer, _ := gzip.NewWriterLevel(w.ResponseWriter, gzip.DefaultCompression)
			w.writer, w.closer = writer, writer
		}
	} else {
		w.writer = w.ResponseWriter
	}

	w.ResponseWriter.WriteHeader(status)
}

func (w *compressionResponseWriter) finish() {
	if !w.started {
		if w.status != 0 {
			w.ResponseWriter.WriteHeader(w.status)
		}
		return
	}
	if w.closer != nil {
		_ = w.closer.Close()
	}
}

func (w *compressionResponseWriter) shouldCompress(status int) bool {
	if status < http.StatusOK || status == http.StatusNoContent || status == http.StatusNotModified || status == http.StatusPartialContent {
		return false
	}
	header := w.Header()
	if header.Get("Content-Encoding") != "" || header.Get("Content-Range") != "" || strings.Contains(strings.ToLower(header.Get("Cache-Control")), "no-transform") {
		return false
	}
	if strings.Contains(strings.ToLower(header.Get("Content-Disposition")), "attachment") {
		return false
	}
	return isCompressibleContentType(header.Get("Content-Type"))
}

func isCompressibleContentType(contentType string) bool {
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil {
		return false
	}
	mediaType = strings.ToLower(mediaType)
	return strings.HasPrefix(mediaType, "text/") ||
		mediaType == "application/json" ||
		mediaType == "application/javascript" ||
		mediaType == "application/xml" ||
		mediaType == "image/svg+xml" ||
		strings.HasSuffix(mediaType, "+json") ||
		strings.HasSuffix(mediaType, "+xml")
}

func selectContentEncoding(acceptEncoding string) string {
	qualities := map[string]float64{}
	for _, token := range strings.Split(acceptEncoding, ",") {
		parts := strings.Split(token, ";")
		name := strings.TrimSpace(strings.ToLower(parts[0]))
		if name == "" {
			continue
		}
		quality := 1.0
		for _, parameter := range parts[1:] {
			key, value, found := strings.Cut(strings.TrimSpace(parameter), "=")
			if found && strings.EqualFold(strings.TrimSpace(key), "q") {
				if parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64); err == nil {
					quality = parsed
				}
			}
		}
		qualities[name] = quality
	}

	qualityFor := func(name string) float64 {
		if quality, found := qualities[name]; found {
			return quality
		}
		return qualities["*"]
	}
	brQuality, gzipQuality := qualityFor("br"), qualityFor("gzip")
	if brQuality <= 0 && gzipQuality <= 0 {
		return ""
	}
	if brQuality >= gzipQuality && brQuality > 0 {
		return "br"
	}
	return "gzip"
}
