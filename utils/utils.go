package utils

import (
	"errors"
	"puremania/config"
	"path/filepath"
	"strings"
)

func ResolveAndValidatePath(cfg *config.Config, userPath string) (string, error) {
	if userPath == "" || userPath == "/" {
		return cfg.StorageDir, nil
	}

	cleanedUserPath := filepath.Clean(userPath)

	if strings.Contains(cleanedUserPath, "..") {
		return "", errors.New("invalid path: contains '..'")
	}

	// Check if the path starts with a mount directory name
	parts := strings.Split(strings.Trim(cleanedUserPath, "/"), "/")
	firstPart := parts[0]

	// Check mount directories
	for _, mountPath := range cfg.MountDirs {
		mountName := filepath.Base(mountPath)
		if firstPart == mountName {
			// This is a mount directory access
			remainingPath := ""
			if len(parts) > 1 {
				remainingPath = filepath.Join(parts[1:]...)
			}
			fullPath := filepath.Join(mountPath, remainingPath)
			
			// Security check: ensure the resolved path is within the mount directory
			rel, err := filepath.Rel(mountPath, fullPath)
			if err != nil || strings.HasPrefix(rel, "..") {
				return "", errors.New("invalid path: attempted directory traversal")
			}
			
			return fullPath, nil
		}
	}

	// Regular storage directory access
	fullPath := filepath.Join(cfg.StorageDir, cleanedUserPath)
	
	// Security check: ensure the resolved path is within the storage directory
	rel, err := filepath.Rel(cfg.StorageDir, fullPath)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", errors.New("invalid path: attempted directory traversal")
	}
	
	return fullPath, nil
}

func IsTextFile(mimeType string) bool {
	textTypes := []string{
		"text/",
		"application/json",
		"application/xml",
		"application/javascript",
		"application/x-yaml",
		"application/yaml",
	}

	for _, textType := range textTypes {
		if strings.HasPrefix(mimeType, textType) {
			return true
		}
	}

	return false
}

func IsEditableByExtension(filename string) bool {
	editableExts := []string{
		".txt", ".md", ".json", ".xml", ".html", ".css", ".js",
		".py", ".go", ".java", ".c", ".cpp", ".h", ".hpp",
		".sh", ".bat", ".ps1", ".yaml", ".yml", ".toml",
		".ini", ".conf", ".config", ".env", ".dockerfile",
		".sql", ".csv", ".log", ".gitignore", ".readme",
	}

	ext := strings.ToLower(filepath.Ext(filename))
	for _, editableExt := range editableExts {
		if ext == editableExt {
			return true
		}
	}

	return false
}

