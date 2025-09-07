package main

import (
	"puremania/config"
	"puremania/handlers"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/mux"
)

func main() {
	// 設定を読み込み
	cfg := config.Load()

	fmt.Printf("Server starting on port %d\n", cfg.Port)
	fmt.Printf("Storage directory: %s\n", cfg.StorageDir)
	if len(cfg.MountDirs) > 0 {
		fmt.Printf("Mount directories: %v\n", cfg.MountDirs)
	}

	// ハンドラーを初期化
	handler := handlers.NewHandler(cfg)

	r := mux.NewRouter()

	// API routes
	api := r.PathPrefix("/api").Subrouter()
	api.HandleFunc("/files", handler.ListFiles).Methods("GET")
	api.HandleFunc("/files/upload", handler.UploadFile).Methods("POST")
	api.HandleFunc("/files/download", handler.DownloadFile).Methods("GET")
	api.HandleFunc("/files/content", handler.GetFileContent).Methods("GET")
	api.HandleFunc("/files/download-zip", handler.DownloadZip).Methods("POST")
	api.HandleFunc("/files/save", handler.SaveFile).Methods("POST")
	api.HandleFunc("/files/batch-delete", handler.DeleteMultipleFiles).Methods("POST")
	api.HandleFunc("/files/mkdir", handler.CreateDirectory).Methods("POST")
	api.HandleFunc("/files/move", handler.MoveFile).Methods("POST")
	api.HandleFunc("/files/create", handler.CreateFile).Methods("POST")
	api.HandleFunc("/config", handler.GetConfig).Methods("GET")
	api.HandleFunc("/search", handler.SearchFiles).Methods("POST")
	api.HandleFunc("/storage-info", handler.GetStorageInfo).Methods("GET")

	// 静的ファイルのサービス
	fs := http.FileServer(http.Dir("./static"))
	r.PathPrefix("/static/").Handler(http.StripPrefix("/static/", fs))
	
	// その他のリクエストはindex.htmlを返す
	r.PathPrefix("/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// APIパス以外はindex.htmlを返す
		if !strings.HasPrefix(r.URL.Path, "/api/") {
			http.ServeFile(w, r, "./static/index.html")
		} else {
			http.NotFound(w, r)
		}
	})

	srv := &http.Server{
		Handler:      corsMiddleware(r),
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		WriteTimeout: 300 * time.Second,
		ReadTimeout:  300 * time.Second,
		IdleTimeout:  300 * time.Second,
	}

	log.Fatal(srv.ListenAndServe())
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Range")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges")
		
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
