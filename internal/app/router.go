package app

import (
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/gorilla/mux"
	"puremania/internal/handlers"
	"puremania/internal/middleware"
	"puremania/internal/types"
)

// NewRouter builds the API, static asset, and SPA fallback routes.
func NewRouter(cfg *types.Config, handler *handlers.Handler) http.Handler {
	r := mux.NewRouter()
	api := r.PathPrefix("/api").Subrouter()
	api.HandleFunc("/files", handler.ListFiles).Methods("GET")
	api.HandleFunc("/files/upload", handler.UploadFile).Methods("POST")
	api.HandleFunc("/files/upload-sessions", handler.CreateUpload).Methods("POST")
	api.HandleFunc("/files/upload-sessions/{id}", handler.UploadStatus).Methods("GET")
	api.HandleFunc("/files/upload-sessions/{id}", handler.AbortUpload).Methods("DELETE")
	api.HandleFunc("/files/upload-sessions/{id}/chunks", handler.UploadChunk).Methods("PUT")
	api.HandleFunc("/files/upload-sessions/{id}/complete", handler.CompleteUpload).Methods("POST")
	api.HandleFunc("/files/download", handler.DownloadFile).Methods("GET")
	api.HandleFunc("/files/content", handler.GetFileContent).Methods("GET")
	api.HandleFunc("/files/download-zip", handler.DownloadZip).Methods("POST")
	api.HandleFunc("/files/download-zip/{token}", handler.DownloadPreparedZip).Methods("GET")
	api.HandleFunc("/files/save", handler.SaveFile).Methods("POST")
	api.HandleFunc("/files/delete", handler.DeleteMultipleFiles).Methods("POST")
	api.HandleFunc("/files/mkdir", handler.CreateDirectory).Methods("POST")
	api.HandleFunc("/files/move", handler.MoveFile).Methods("POST")
	api.HandleFunc("/files/create", handler.CreateFile).Methods("POST")
	api.HandleFunc("/files/extract", handler.ExtractFile).Methods("POST")
	api.HandleFunc("/files/thumbnail", handler.Thumbnail).Methods("GET")
	api.HandleFunc("/config", handler.GetConfig).Methods("GET")
	api.HandleFunc("/search", handler.SearchFiles).Methods("POST")
	api.HandleFunc("/storage-info", handler.GetStorageInfo).Methods("GET")
	api.HandleFunc("/specific-dirs", handler.GetSpecificDirs).Methods("GET")
	api.HandleFunc("/health", handler.HealthCheck).Methods("GET")
	api.HandleFunc("/events", handler.Events).Methods("GET")
	if cfg.Aria2cEnabled {
		api.HandleFunc("/system/aria2c/download", handler.DownloadWithAria2c).Methods("POST")
		api.HandleFunc("/system/aria2c/status", handler.GetAria2cStatus).Methods("GET")
		api.HandleFunc("/system/aria2c/control", handler.ControlAria2cDownload).Methods("POST")
	}

	staticFileHandler := http.StripPrefix("/static/", middleware.StaticCache(http.FileServer(http.Dir("./static/"))))
	r.PathPrefix("/static/").Handler(staticFileHandler)
	indexETag := ""
	if info, err := os.Stat("./static/index.html"); err == nil {
		indexETag = fmt.Sprintf("\"%x-%x\"", info.ModTime().UnixNano(), info.Size())
	}
	r.PathPrefix("/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		if !strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasPrefix(r.URL.Path, "/static/") {
			if indexETag != "" {
				w.Header().Set("ETag", indexETag)
				if r.Header.Get("If-None-Match") == indexETag {
					w.WriteHeader(http.StatusNotModified)
					return
				}
			}
			http.ServeFile(w, r, "./static/index.html")
			return
		}
		r.URL.Path = "/"
		http.NotFound(w, r)
	})
	return r
}
