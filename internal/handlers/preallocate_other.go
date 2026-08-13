//go:build !linux

package handlers

import "os"

func preallocateUpload(_ *os.File, _ int64) error { return nil }
