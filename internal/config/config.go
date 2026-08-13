package config

import (
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
	"puremania/internal/types"
)

const (
	defaultMaxFileSize           int64 = 102400
	defaultPort                        = 8844
	defaultZipTimeout                  = 300
	defaultMaxZipSize            int64 = 1024
	defaultUploadSessionTTLHours       = 168
	maxConfigSizeMB              int64 = (1<<63 - 1) / (1 << 20)
	maxDurationSeconds           int64 = (1<<63 - 1) / int64(time.Second)
	maxDurationHours             int   = (1<<63 - 1) / int(time.Hour)
)

// Load reads application configuration from the environment and optional .env file.
func Load(logger *slog.Logger) *types.Config {
	_ = godotenv.Load()

	config := &types.Config{
		StorageDir:            getEnv("STORAGE_DIR", "/home/"+os.Getenv("USER")),
		MountDirs:             getEnvAsStringSlice("MOUNT_DIRS", []string{}),
		MaxFileSize:           getEnvAsInt64(logger, "MAX_FILE_SIZE_MB", defaultMaxFileSize),
		Port:                  getEnvAsInt(logger, "PORT", defaultPort),
		ZipTimeout:            getEnvAsInt(logger, "ZIP_TIMEOUT", defaultZipTimeout),
		MaxZipSize:            getEnvAsInt64(logger, "MAX_ZIP_SIZE", defaultMaxZipSize),
		SpecificDirs:          getEnvAsStringSlice("SPECIFIC_DIRS", []string{}),
		UploadSessionTTLHours: getEnvAsInt(logger, "UPLOAD_SESSION_TTL_HOURS", defaultUploadSessionTTLHours),
		PreallocateUploads:    getEnvAsBool("UPLOAD_PREALLOCATE", true),
	}
	validateConfig(logger, config)
	config.Aria2cEnabled = strings.EqualFold(getEnv("ARIA2C", "disable"), "enable")

	if len(config.SpecificDirs) == 0 {
		home := os.Getenv("HOME")
		for _, dir := range []string{"Documents", "Downloads", "Pictures", "Videos", "Music"} {
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

func validateConfig(logger *slog.Logger, config *types.Config) {
	if config.MaxFileSize <= 0 || config.MaxFileSize > maxConfigSizeMB {
		logger.Warn("Invalid MAX_FILE_SIZE_MB; using fallback", "value", config.MaxFileSize, "fallback", defaultMaxFileSize)
		config.MaxFileSize = defaultMaxFileSize
	}
	if config.MaxZipSize <= 0 || config.MaxZipSize > maxConfigSizeMB {
		logger.Warn("Invalid MAX_ZIP_SIZE; using fallback", "value", config.MaxZipSize, "fallback", defaultMaxZipSize)
		config.MaxZipSize = defaultMaxZipSize
	}
	if config.Port < 1 || config.Port > 65535 {
		logger.Warn("Invalid PORT; using fallback", "value", config.Port, "fallback", defaultPort)
		config.Port = defaultPort
	}
	if config.ZipTimeout <= 0 || int64(config.ZipTimeout) > maxDurationSeconds {
		logger.Warn("Invalid ZIP_TIMEOUT; using fallback", "value", config.ZipTimeout, "fallback", defaultZipTimeout)
		config.ZipTimeout = defaultZipTimeout
	}
	if config.UploadSessionTTLHours <= 0 || config.UploadSessionTTLHours > maxDurationHours {
		logger.Warn("Invalid UPLOAD_SESSION_TTL_HOURS; using fallback", "value", config.UploadSessionTTLHours, "fallback", defaultUploadSessionTTLHours)
		config.UploadSessionTTLHours = defaultUploadSessionTTLHours
	}
}

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

func getEnvAsInt(logger *slog.Logger, key string, fallback int) int {
	if value, exists := os.LookupEnv(key); exists {
		if parsed, err := strconv.Atoi(value); err == nil {
			return parsed
		} else {
			logger.Warn("Invalid integer value for env var, using fallback", "key", key, "value", value, "error", err)
		}
	}
	return fallback
}

func getEnvAsInt64(logger *slog.Logger, key string, fallback int64) int64 {
	if value, exists := os.LookupEnv(key); exists {
		if parsed, err := strconv.ParseInt(value, 10, 64); err == nil {
			return parsed
		} else {
			logger.Warn("Invalid int64 value for env var, using fallback", "key", key, "value", value, "error", err)
		}
	}
	return fallback
}

func getEnvAsStringSlice(key string, fallback []string) []string {
	if value, exists := os.LookupEnv(key); exists {
		if value == "" {
			return []string{}
		}
		return strings.Split(value, ",")
	}
	return fallback
}
