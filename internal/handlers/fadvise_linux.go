//go:build linux

package handlers

import (
	"os"

	"golang.org/x/sys/unix"
)

// prepareUploadRange tells Linux that a sequential upload range will not be
// reused. It is an advisory call: a filesystem may ignore it without affecting
// data integrity or resumability.
func prepareUploadRange(file *os.File, offset, length int64) {
	_ = unix.Fadvise(int(file.Fd()), offset, length, unix.FADV_NOREUSE)
}

// releaseUploadRange runs only after fsync succeeded. DONTNEED prevents a large
// upload from occupying the container's page-cache accounting after its data is
// safely on disk. Linux may defer or ignore the hint by design.
func releaseUploadRange(file *os.File, offset, length int64) {
	_ = unix.Fadvise(int(file.Fd()), offset, length, unix.FADV_DONTNEED)
}
