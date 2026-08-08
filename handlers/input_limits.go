package handlers

import "fmt"

const (
	maxVirtualPathBytes  = 4096
	maxRelativePathBytes = 4096
	maxBatchPaths        = 1000
	maxSearchTermBytes   = 1024
	maxAria2URLBytes     = 8192
	maxAria2GIDBytes     = 128
)

func validateBatchPaths(paths []string) error {
	if len(paths) == 0 {
		return fmt.Errorf("at least one path is required")
	}
	if len(paths) > maxBatchPaths {
		return fmt.Errorf("too many paths")
	}
	for _, path := range paths {
		if len(path) > maxVirtualPathBytes {
			return fmt.Errorf("path is too long")
		}
	}
	return nil
}
