package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"puremania/internal/aria2"
	"puremania/internal/config"
	"puremania/internal/handlers"
	"puremania/internal/health"
	"puremania/internal/middleware"
)

// Run starts Pure Mania and returns a process exit code.
func Run(args []string) int {
	if len(args) > 0 && args[0] == "healthcheck" {
		return health.Run()
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg := config.Load(logger)
	if cfg.Aria2cEnabled {
		rpcURL, rpcToken, err := aria2.Start(logger)
		if err != nil {
			logger.Error("Error starting aria2c", "error", err)
			return 1
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

	handler := handlers.NewHandler(cfg, logger)
	router := NewRouter(cfg, handler)
	server := &http.Server{
		Handler: middleware.SecurityHeaders(middleware.CSRF(middleware.RequestBodyLimit(middleware.ResponseCompression(router)))),
		Addr:    fmt.Sprintf(":%d", cfg.Port), ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout: 10 * time.Minute, WriteTimeout: 10 * time.Minute,
		IdleTimeout: 120 * time.Second, MaxHeaderBytes: 32 << 10,
	}

	shutdownContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-shutdownContext.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := server.Shutdown(ctx); err != nil {
			logger.Error("Graceful shutdown failed", "error", err)
		}
	}()
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("Server stopped", "error", err)
		return 1
	}
	return 0
}
