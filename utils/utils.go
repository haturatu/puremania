package utils

import (
	"path/filepath"
	"strings"
)

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
