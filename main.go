package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"puremania/handlers"
	"puremania/types"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
)

// generateSecureToken は暗号論的に安全なランダムトークンを生成します
func generateSecureToken(length int) (string, error) {
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// startAria2cDaemon はaria2cをデーモンとして起動し、設定を返します
func startAria2cDaemon(logger *slog.Logger) (rpcURL string, rpcToken string, err error) {
	logger.Info("Aria2c feature enabled. Starting aria2c daemon...")

	token, err := generateSecureToken(16)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate secure token for aria2c: %w", err)
	}

	rpcPort := "6800"
	rpcURL = fmt.Sprintf("http://localhost:%s/jsonrpc", rpcPort)

	cmd := exec.Command(
		"aria2c",
		"--enable-rpc",
		"--rpc-listen-all=true",
		"--rpc-listen-port", rpcPort,
		"--rpc-secret", token,
		"--no-conf",
		"--log-level=warn",
		"--quiet=true",
	)

	// 標準出力とエラー出力を破棄
	cmd.Stdout = nil
	cmd.Stderr = nil

	// 非同期でコマンドを開始
	if err := cmd.Start(); err != nil {
		return "", "", fmt.Errorf("failed to start aria2c process. Is aria2c installed and in your PATH?: %w", err)
	}

	logger.Info("Aria2c process started successfully", "pid", cmd.Process.Pid)

	// プログラム終了時にaria2cプロセスも終了するようにする
	go func() {
		_ = cmd.Wait()
	}()

	// RPCサーバーが起動するのを少し待つ
	time.Sleep(2 * time.Second)

	return rpcURL, token, nil
}

// LoadConfig は.envファイルから設定を読み込みます
func LoadConfig(logger *slog.Logger) *types.Config {
	_ = godotenv.Load() // .envファイルが見つからなくてもエラーにしない

	// デフォルト値
	config := &types.Config{
		StorageDir:   getEnv("STORAGE_DIR", "/home/"+os.Getenv("USER")),
		MountDirs:    getEnvAsStringSlice("MOUNT_DIRS", []string{}),
		MaxFileSize:  getEnvAsInt64(logger, "MAX_FILE_SIZE_MB", 10000),
		Port:         getEnvAsInt(logger, "PORT", 8844),
		ZipTimeout:   getEnvAsInt(logger, "ZIP_TIMEOUT", 300),
		MaxZipSize:   getEnvAsInt64(logger, "MAX_ZIP_SIZE", 1024),
		SpecificDirs: getEnvAsStringSlice("SPECIFIC_DIRS", []string{}),
		// Aria2cEnabled は後で設定
	}

	// ARIA2C=enable かどうかを判定
	config.Aria2cEnabled = strings.ToLower(getEnv("ARIA2C", "disable")) == "enable"

	// SpecificDirsが空の場合のデフォルト値設定
	if len(config.SpecificDirs) == 0 {
		home := os.Getenv("HOME")
		defaultDirs := []string{"Documents", "Downloads", "Pictures", "Videos", "Music"}
		for _, dir := range defaultDirs {
			fullPath := filepath.Join(home, dir)
			if info, err := os.Stat(fullPath); err == nil && info.IsDir() {
				config.SpecificDirs = append(config.SpecificDirs, fullPath)
			} else if err != nil && !os.IsNotExist(err) {
				logger.Warn("Failed to stat default specific dir", "path", fullPath, "error", err)
			}
		}
	}

	return config
}

func main() {
	// ロガーを初期化
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	// 設定を読み込み
	cfg := LoadConfig(logger)

	// Aria2cが有効な場合はデーモンを起動
	if cfg.Aria2cEnabled {
		rpcURL, rpcToken, err := startAria2cDaemon(logger)
		if err != nil {
			logger.Error("Error starting aria2c", "error", err)
			os.Exit(1)
		}
		cfg.Aria2cRPCURL = rpcURL
		cfg.Aria2cRPCToken = rpcToken
	}

	logger.Info("Server starting", "port", cfg.Port)
	logger.Info("Storage directory", "path", cfg.StorageDir)
	if len(cfg.MountDirs) > 0 {
		logger.Info("Mount directories", "paths", cfg.MountDirs)
	}
	if len(cfg.SpecificDirs) > 0 {
		logger.Info("Specific directories", "paths", cfg.SpecificDirs)
	}
	if cfg.Aria2cEnabled {
		logger.Info("Aria2c feature is enabled.")
	} else {
		logger.Info("Aria2c feature is disabled.")
	}

	// ハンドラーを初期化
	handler := handlers.NewHandler(cfg, logger)

	r := mux.NewRouter()

	// API routes
	api := r.PathPrefix("/api").Subrouter()
	api.HandleFunc("/files", handler.ListFiles).Methods("GET")
	api.HandleFunc("/files/upload", handler.UploadFile).Methods("POST")
	api.HandleFunc("/files/download", handler.DownloadFile).Methods("GET")
	api.HandleFunc("/files/content", handler.GetFileContent).Methods("GET")
	api.HandleFunc("/files/download-zip", handler.DownloadZip).Methods("POST")
	api.HandleFunc("/files/save", handler.SaveFile).Methods("POST")
	api.HandleFunc("/files/delete", handler.DeleteMultipleFiles).Methods("POST")
	api.HandleFunc("/files/mkdir", handler.CreateDirectory).Methods("POST")
	api.HandleFunc("/files/move", handler.MoveFile).Methods("POST")
	api.HandleFunc("/files/create", handler.CreateFile).Methods("POST")
	api.HandleFunc("/files/extract", handler.ExtractFile).Methods("POST")
	api.HandleFunc("/config", handler.GetConfig).Methods("GET")
	api.HandleFunc("/search", handler.SearchFiles).Methods("POST")
	api.HandleFunc("/storage-info", handler.GetStorageInfo).Methods("GET")
	api.HandleFunc("/specific-dirs", handler.GetSpecificDirs).Methods("GET")
	api.HandleFunc("/health", handler.HealthCheck).Methods("GET")

	// Aria2cが有効な場合のみエンドポイントを登録
	if cfg.Aria2cEnabled {
		api.HandleFunc("/system/aria2c/download", handler.DownloadWithAria2c).Methods("POST")
		api.HandleFunc("/system/aria2c/status", handler.GetAria2cStatus).Methods("GET")
		api.HandleFunc("/system/aria2c/control", handler.ControlAria2cDownload).Methods("POST")
	}

	// 静的ファイルのサービス
	staticFileHandler := http.StripPrefix("/static/", http.FileServer(http.Dir("./static/")))
	r.PathPrefix("/static/").Handler(staticFileHandler)

	// その他のリクエストはindex.htmlを返す
	r.PathPrefix("/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// APIパス以外はindex.htmlを返す
		if !strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasPrefix(r.URL.Path, "/static/") {
			http.ServeFile(w, r, "./static/index.html")
		} else {
			// muxがよしなに処理してくれるので、ここはシンプルに
			r.URL.Path = "/" // Not foundを避けるため、ルートにフォールバック
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

	logger.Error("Server stopped", "error", srv.ListenAndServe())
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Range, Content-Disposition, X-Requested-With")
		w.Header().Set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges, Content-Disposition")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Max-Age", "86400") // 24時間

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// getEnv は環境変数を読み込み、見つからない場合はデフォルト値を返す
func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}

// getEnvAsInt は環境変数を整数として読み込み
func getEnvAsInt(logger *slog.Logger, key string, fallback int) int {
	if value, exists := os.LookupEnv(key); exists {
		if i, err := strconv.Atoi(value); err == nil {
			return i
		} else {
			logger.Warn("Invalid integer value for env var, using fallback", "key", key, "value", value, "error", err)
		}
	}
	return fallback
}

// getEnvAsInt64 は環境変数をint64として読み込み
func getEnvAsInt64(logger *slog.Logger, key string, fallback int64) int64 {
	if value, exists := os.LookupEnv(key); exists {
		if i, err := strconv.ParseInt(value, 10, 64); err == nil {
			return i
		} else {
			logger.Warn("Invalid int64 value for env var, using fallback", "key", key, "value", value, "error", err)
		}
	}
	return fallback
}

// getEnvAsStringSlice はカンマ区切りの環境変数を文字列スライスとして読み込み
func getEnvAsStringSlice(key string, fallback []string) []string {
	if value, exists := os.LookupEnv(key); exists {
		if value == "" {
			return []string{}
		}
		return strings.Split(value, ",")
	}
	return fallback
}
