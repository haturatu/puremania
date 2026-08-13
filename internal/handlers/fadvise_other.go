//go:build !linux

package handlers

import "os"

// Non-Linux targets retain the exact upload behavior without platform-specific
// cache hints.
func prepareUploadRange(_ *os.File, _, _ int64) {}
func releaseUploadRange(_ *os.File, _, _ int64) {}
