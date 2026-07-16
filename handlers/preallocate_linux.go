//go:build linux

package handlers

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

// preallocateUpload reserves blocks without changing the logical EOF. This
// works with retry truncation while still reporting ENOSPC at session creation.
func preallocateUpload(file *os.File, size int64) error {
	err := unix.Fallocate(int(file.Fd()), unix.FALLOC_FL_KEEP_SIZE, 0, size)
	if errors.Is(err, unix.EOPNOTSUPP) || errors.Is(err, unix.ENOSYS) || errors.Is(err, unix.EINVAL) {
		return nil
	}
	return err
}
