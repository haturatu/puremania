package handlers

import (
	"fmt"
	"os"
	"path/filepath"
)

// openAllowedPath resolves the allowed root once and opens the target beneath
// that directory. The platform implementation uses the strongest available
// path-confinement primitive so a symlink swap cannot redirect the open outside
// the configured root.
func (h *Handler) openAllowedPath(path string, flags int, perm os.FileMode) (*os.File, error) {
	root, relative, err := h.allowedRootForPath(path)
	if err != nil {
		return nil, err
	}
	return openBeneath(root, relative, flags, perm)
}

func (h *Handler) allowedRootForPath(path string) (string, string, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", "", fmt.Errorf("could not get absolute path: %w", err)
	}
	resolvedPath, err := resolveExistingPath(filepath.Clean(absPath))
	if err != nil {
		return "", "", err
	}

	allowedDirs := make([]string, 0, len(h.config.MountDirs)+1+len(h.config.SpecificDirs))
	allowedDirs = append(allowedDirs, h.config.MountDirs...)
	allowedDirs = append(allowedDirs, h.config.StorageDir)
	allowedDirs = append(allowedDirs, h.config.SpecificDirs...)
	for _, allowedDir := range allowedDirs {
		absAllowed, err := filepath.Abs(allowedDir)
		if err != nil {
			continue
		}
		resolvedAllowed, err := resolveExistingPath(filepath.Clean(absAllowed))
		if err != nil || !isPathWithin(resolvedAllowed, resolvedPath) {
			continue
		}
		relative, err := filepath.Rel(resolvedAllowed, resolvedPath)
		if err != nil {
			continue
		}
		return resolvedAllowed, relative, nil
	}

	return "", "", fmt.Errorf("path is not in an allowed directory: %s", path)
}
