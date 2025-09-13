package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"puremania/handlers"
	"puremania/types"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
)

func GetStorageDir(c *types.Config) string {
	return c.StorageDir
}

func GetMountDirs(c *types.Config) []string {
	return c.MountDirs
}

func GetMaxFileSize(c *types.Config) int64 {
	return c.MaxFileSize
}

func GetSpecificDirs(c *types.Config) []string {
	return c.SpecificDirs
}

// Load は.envファイルから設定を読み込みます。
func LoadConfig() *types.Config {
	_ = godotenv.Load() // .envファイルが見つからなくてもエラーにしない

	// デフォルト値
	config := &types.Config{
		StorageDir:      getEnv("STORAGE_DIR", "/home/"+os.Getenv("USER")),
		MountDirs:       getEnvAsStringSlice("MOUNT_DIRS", []string{}),
		MaxFileSize:     getEnvAsInt64("MAX_FILE_SIZE_MB", 10000),
		Port:            getEnvAsInt("PORT", 8844),
		ZipTimeout:      getEnvAsInt("ZIP_TIMEOUT", 300),
		MaxZipSize:      getEnvAsInt64("MAX_ZIP_SIZE", 1024),
		SpecificDirs:    getEnvAsStringSlice("SPECIFIC_DIRS", []string{}),
	}

	// SpecificDirsが空の場合のデフォルト値設定
	if len(config.SpecificDirs) == 0 {
		home := os.Getenv("HOME")
		defaultDirs := []string{"Documents", "Downloads", "Pictures", "Videos", "Music"}
		for _, dir := range defaultDirs {
			fullPath := filepath.Join(home, dir)
			if info, err := os.Stat(fullPath); err == nil && info.IsDir() {
				config.SpecificDirs = append(config.SpecificDirs, fullPath)
			}
		}
	}

	return config
}

func main() {
	// 設定を読み込み
	cfg := LoadConfig()

	fmt.Printf("Server starting on port %d\n", cfg.Port)
	fmt.Printf("Storage directory: %s\n", cfg.StorageDir)
	if len(cfg.MountDirs) > 0 {
		fmt.Printf("Mount directories: %v\n", cfg.MountDirs)
	}
	if len(cfg.SpecificDirs) > 0 {
		fmt.Printf("Specific directories: %v\n", cfg.SpecificDirs)
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
	api.HandleFunc("/specific-dirs", handler.GetSpecificDirs).Methods("GET")
	api.HandleFunc("/health", handler.HealthCheck).Methods("GET")

	// 静的ファイルのサービス
	    staticFileHandler := http.StripPrefix("/static/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// --- START DEBUG LOGGING ---
		requestedPath := "./static/" + r.URL.Path
		// log.Printf("Static file requested: %s", r.URL.Path)
		// log.Printf("Serving from filesystem path: %s", requestedPath)
		// --- END DEBUG LOGGING ---

		if strings.HasSuffix(r.URL.Path, ".js") {
			w.Header().Set("Content-Type", "application/javascript")
		}
		http.ServeFile(w, r, requestedPath)
	}))
	r.PathPrefix("/static/").Handler(staticFileHandler)

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
		// 許可するオリジンを設定（実際のデプロイ時には適切なオリジンに変更）
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Range, Content-Disposition, X-Requested-With")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges, Content-Disposition")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Max-Age", "86400") // 24時間

		// Preflightリクエストへの対応
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// getEnv は環境変数を読み込み、見つからない場合はデフォルト値を返します。
func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}

// getEnvAsInt は環境変数を整数として読み込みます。
func getEnvAsInt(key string, fallback int) int {
	if value, exists := os.LookupEnv(key); exists {
		if i, err := strconv.Atoi(value); err == nil {
			return i
		}
	}
	return fallback
}

// getEnvAsInt64 は環境変数をint64として読み込みます。
func getEnvAsInt64(key string, fallback int64) int64 {
	if value, exists := os.LookupEnv(key); exists {
		if i, err := strconv.ParseInt(value, 10, 64); err == nil {
			return i
		}
	}
	return fallback
}

// getEnvAsStringSlice はカンマ区切りの環境変数を文字列スライスとして読み込みます。
func getEnvAsStringSlice(key string, fallback []string) []string {
	if value, exists := os.LookupEnv(key); exists {
		if value == "" {
			return []string{}
		}
		return strings.Split(value, ",")
	}
	return fallback
}