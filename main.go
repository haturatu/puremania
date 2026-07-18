package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"puremania/handlers"
	"puremania/types"
	"strconv"
	"strings"
	"syscall"
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

	// aria2c is a child process of this container. Container restarts terminate
	// it with the application, so scanning and killing unrelated processes is
	// unnecessary (and avoids requiring lsof/procps in the runtime image).
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
		StorageDir: getEnv("STORAGE_DIR", "/home/"+os.Getenv("USER")),
		MountDirs:  getEnvAsStringSlice("MOUNT_DIRS", []string{}),
		// 100 GiB default leaves headroom for 50 GiB resumable uploads. Chunks
		// are streamed, so this is a validation limit rather than RAM usage.
		MaxFileSize:           getEnvAsInt64(logger, "MAX_FILE_SIZE_MB", 102400),
		Port:                  getEnvAsInt(logger, "PORT", 8844),
		ZipTimeout:            getEnvAsInt(logger, "ZIP_TIMEOUT", 300),
		MaxZipSize:            getEnvAsInt64(logger, "MAX_ZIP_SIZE", 1024),
		SpecificDirs:          getEnvAsStringSlice("SPECIFIC_DIRS", []string{}),
		UploadSessionTTLHours: getEnvAsInt(logger, "UPLOAD_SESSION_TTL_HOURS", 168),
		PreallocateUploads:    getEnvAsBool("UPLOAD_PREALLOCATE", true),
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
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(runHealthcheck())
	}
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
	// Resumable uploads are a separate resource from the legacy multipart
	// endpoint above. The explicit /chunks segment makes the PUT semantics clear.
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

	// Aria2cが有効な場合のみエンドポイントを登録
	if cfg.Aria2cEnabled {
		api.HandleFunc("/system/aria2c/download", handler.DownloadWithAria2c).Methods("POST")
		api.HandleFunc("/system/aria2c/status", handler.GetAria2cStatus).Methods("GET")
		api.HandleFunc("/system/aria2c/control", handler.ControlAria2cDownload).Methods("POST")
	}

	// 静的ファイルのサービス
	staticFileHandler := http.StripPrefix("/static/", staticCacheMiddleware(http.FileServer(http.Dir("./static/"))))
	r.PathPrefix("/static/").Handler(staticFileHandler)
	indexETag := ""
	if info, err := os.Stat("./static/index.html"); err == nil {
		indexETag = fmt.Sprintf("\"%x-%x\"", info.ModTime().UnixNano(), info.Size())
	}

	// その他のリクエストはindex.htmlを返す
	r.PathPrefix("/").HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache, must-revalidate")
		// APIパス以外はindex.htmlを返す
		if !strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasPrefix(r.URL.Path, "/static/") {
			if indexETag != "" {
				w.Header().Set("ETag", indexETag)
				if r.Header.Get("If-None-Match") == indexETag {
					w.WriteHeader(http.StatusNotModified)
					return
				}
			}
			http.ServeFile(w, r, "./static/index.html")
		} else {
			// muxがよしなに処理してくれるので、ここはシンプルに
			r.URL.Path = "/" // Not foundを避けるため、ルートにフォールバック
			http.NotFound(w, r)
		}
	})

	srv := &http.Server{
		Handler:           responseCompressionMiddleware(r),
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    32 << 10,
	}
	shutdownContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-shutdownContext.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			logger.Error("Graceful shutdown failed", "error", err)
		}
	}()
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("Server stopped", "error", err)
	}
}

func runHealthcheck() int {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	port := getEnvAsInt(logger, "PORT", 8844)
	return runHealthcheckURL(fmt.Sprintf("http://127.0.0.1:%d/api/health", port), os.Stderr)
}

func runHealthcheckURL(url string, stderr io.Writer) int {
	client := &http.Client{
		Timeout: 4 * time.Second,
		Transport: &http.Transport{
			DisableKeepAlives: true,
			DialContext:       (&net.Dialer{Timeout: 2 * time.Second, KeepAlive: -1}).DialContext,
		},
	}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, url, nil)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, err)
		return 1
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "puremania-healthcheck")
	response, err := client.Do(req)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, err)
		return 1
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		_, _ = fmt.Fprintf(stderr, "unexpected HTTP status: %s\n", response.Status)
		return 1
	}
	var health struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<10)).Decode(&health); err != nil {
		_, _ = fmt.Fprintf(stderr, "invalid health response: %v\n", err)
		return 1
	}
	if health.Status != "ok" {
		_, _ = fmt.Fprintf(stderr, "unhealthy status: %q\n", health.Status)
		return 1
	}
	return 0
}

func staticCacheMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/dist/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			// Raw modules, templates, and remote-mode CSS retain stable URLs.
			// Revalidate them so a switch never serves a previous version.
			w.Header().Set("Cache-Control", "no-cache")
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

func getEnvAsBool(key string, fallback bool) bool {
	value, exists := os.LookupEnv(key)
	if !exists {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
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
