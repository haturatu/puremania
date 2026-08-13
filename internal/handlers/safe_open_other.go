//go:build !linux

package handlers

import (
	"os"
	"path/filepath"
)

// Non-Linux builds retain the existing behavior; Linux deployments use
// openat2(2) through safe_open_linux.go for race-resistant path confinement.
func openBeneath(root, relative string, flags int, perm os.FileMode) (*os.File, error) {
	return os.OpenFile(filepath.Join(root, relative), flags, perm)
}

func childProcessFilePath(_ *os.File, original string) (string, []*os.File) {
	return original, nil
}
