package main

import (
	"io"
	"log/slog"
	"math"
	"testing"

	"puremania/types"
)

func TestValidateConfigRejectsInvalidValues(t *testing.T) {
	config := &types.Config{
		MaxFileSize:           -1,
		Port:                  65536,
		ZipTimeout:            -1,
		MaxZipSize:            math.MaxInt64,
		UploadSessionTTLHours: math.MaxInt,
	}

	validateConfig(slog.New(slog.NewTextHandler(io.Discard, nil)), config)

	if config.MaxFileSize != defaultMaxFileSize {
		t.Fatalf("MaxFileSize=%d, want fallback %d", config.MaxFileSize, defaultMaxFileSize)
	}
	if config.MaxZipSize != defaultMaxZipSize {
		t.Fatalf("MaxZipSize=%d, want fallback %d", config.MaxZipSize, defaultMaxZipSize)
	}
	if config.Port != defaultPort {
		t.Fatalf("Port=%d, want fallback %d", config.Port, defaultPort)
	}
	if config.ZipTimeout != defaultZipTimeout {
		t.Fatalf("ZipTimeout=%d, want fallback %d", config.ZipTimeout, defaultZipTimeout)
	}
	if config.UploadSessionTTLHours != defaultUploadSessionTTLHours {
		t.Fatalf("UploadSessionTTLHours=%d, want fallback %d", config.UploadSessionTTLHours, defaultUploadSessionTTLHours)
	}
}

func TestValidateConfigAllowsSafeBoundaryValues(t *testing.T) {
	config := &types.Config{
		MaxFileSize:           maxConfigSizeMB,
		Port:                  1,
		ZipTimeout:            int(maxDurationSeconds),
		MaxZipSize:            maxConfigSizeMB,
		UploadSessionTTLHours: maxDurationHours,
	}

	validateConfig(slog.New(slog.NewTextHandler(io.Discard, nil)), config)

	if config.MaxFileSize != maxConfigSizeMB || config.MaxZipSize != maxConfigSizeMB {
		t.Fatal("maximum safe byte-limit values should remain unchanged")
	}
	if config.Port != 1 || config.ZipTimeout != int(maxDurationSeconds) || config.UploadSessionTTLHours != maxDurationHours {
		t.Fatal("maximum safe duration and minimum port values should remain unchanged")
	}
}
