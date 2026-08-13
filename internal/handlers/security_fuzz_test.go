package handlers

import (
	"strings"
	"testing"
)

func FuzzParseContentRange(f *testing.F) {
	for _, seed := range []string{
		"bytes 0-9/10",
		"bytes 1-0/2",
		"bytes -1-4/5",
		"bytes 9223372036854775807-9223372036854775807/9223372036854775807",
	} {
		f.Add(seed)
	}
	f.Fuzz(func(_ *testing.T, value string) {
		_, _, _, _ = parseContentRange(value)
	})
}

func FuzzSecureJoin(f *testing.F) {
	for _, seed := range []string{"file.txt", "../outside", "a/../../b", "link/file"} {
		f.Add(seed)
	}
	base := f.TempDir()
	f.Fuzz(func(_ *testing.T, relative string) {
		_, _ = secureJoin(base, relative)
	})
}

func FuzzValidateBatchPaths(f *testing.F) {
	for _, seed := range []string{"/file.txt", "/a\x00/b", strings.Repeat("x", maxVirtualPathBytes+1)} {
		f.Add(seed)
	}
	f.Fuzz(func(_ *testing.T, value string) {
		_ = validateBatchPaths(strings.Split(value, "\x00"))
	})
}

func FuzzContentDisposition(f *testing.F) {
	for _, seed := range []string{"file.txt", "report\".txt", "line\r\nX-Injected: true", "日本語.txt"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, filename string) {
		formatted := contentDisposition(filename)
		if strings.ContainsAny(formatted, "\r\n") {
			t.Fatalf("formatted filename contains a line break: %q", formatted)
		}
	})
}
