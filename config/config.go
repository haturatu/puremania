package config

import (
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	StorageDir   string   `json:"storage_dir"`
	MountDirs    []string `json:"mount_dirs"`
	SpecificDirs []string `json:"specific_dirs"`
	Port         int      `json:"port"`
	MaxFileSize  int64    `json:"max_file_size"` // MB
	ZipTimeout   int      `json:"zip_timeout"`   // 秒
	MaxZipSize   int64    `json:"max_zip_size"`  // MB
}

func Load() *Config {
	// .envファイルを読み込み（存在しない場合はエラーにしない）
	if err := godotenv.Load(); err != nil {
		log.Println("Warning: .env file not found, using environment variables or defaults")
	}

	config := &Config{
		StorageDir:  getEnv("STORAGE_DIR", ""),
		Port:        getEnvAsInt("PORT", 8080),
		MaxFileSize: getEnvAsInt64("MAX_FILE_SIZE_MB", 100),
		ZipTimeout:  getEnvAsInt("ZIP_TIMEOUT", 300),      // デフォルト5分
		MaxZipSize:  getEnvAsInt64("MAX_ZIP_SIZE_MB", 1024), // デフォルト1GB
	}

	// マウントディレクトリの設定（カンマ区切り）
	mountDirsStr := getEnv("MOUNT_DIRS", "")
	if mountDirsStr != "" {
		config.MountDirs = strings.Split(mountDirsStr, ",")
		// 前後の空白を削除
		for i, dir := range config.MountDirs {
			config.MountDirs[i] = strings.TrimSpace(dir)
		}
	}

	// 特定のディレクトリの設定（カンマ区切り）
	specificDirsStr := getEnv("SPECIFIC_DIRS", "")
	if specificDirsStr != "" {
		config.SpecificDirs = strings.Split(specificDirsStr, ",")
		// 前後の空白を削除
		for i, dir := range config.SpecificDirs {
			config.SpecificDirs[i] = strings.TrimSpace(dir)
		}
	} else {
		// デフォルトのディレクトリを設定
		homeDir, err := os.UserHomeDir()
		if err != nil {
			log.Printf("Warning: Could not get user home directory: %v", err)
			config.SpecificDirs = []string{}
		} else {
			defaultDirs := []string{"Documents", "Images", "Music", "Videos", "Downloads"}
			config.SpecificDirs = make([]string, 0, len(defaultDirs))
			for _, dir := range defaultDirs {
				fullPath := homeDir + "/" + dir
				config.SpecificDirs = append(config.SpecificDirs, fullPath)
			}
		}
	}

	// ストレージディレクトリを作成
	os.MkdirAll(config.StorageDir, 0755)

	return config
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvAsInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return defaultValue
}

func getEnvAsInt64(key string, defaultValue int64) int64 {
	if value := os.Getenv(key); value != "" {
		if intVal, err := strconv.ParseInt(value, 10, 64); err == nil {
			return intVal
		}
	}
	return defaultValue
}
