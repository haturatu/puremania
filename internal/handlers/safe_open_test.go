package handlers

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"puremania/internal/types"
)

func TestOpenAllowedPathRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.txt")
	if err := os.WriteFile(secret, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}

	h := NewHandler(&types.Config{StorageDir: root}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if _, err := h.openAllowedPath(filepath.Join(root, "link", "secret.txt"), os.O_RDONLY, 0); err == nil {
		t.Fatal("expected a symlink escaping the configured root to be rejected")
	}
}

func TestOpenAllowedPathReadsWithinRoot(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "file.txt")
	if err := os.WriteFile(path, []byte("content"), 0600); err != nil {
		t.Fatal(err)
	}

	h := NewHandler(&types.Config{StorageDir: root}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	file, err := h.openAllowedPath(path, os.O_RDONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = file.Close() }()
	content, err := io.ReadAll(file)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "content" {
		t.Fatalf("content = %q, want content", content)
	}
}
