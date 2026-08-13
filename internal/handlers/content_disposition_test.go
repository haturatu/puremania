package handlers

import (
	"strings"
	"testing"
)

func TestContentDispositionEncodesFilename(t *testing.T) {
	got := contentDisposition(`report"final.txt`)

	if strings.ContainsAny(got, "\r\n") {
		t.Fatalf("Content-Disposition contains a line break: %q", got)
	}
	if !strings.HasPrefix(got, "inline; filename=") {
		t.Fatalf("Content-Disposition = %q, want inline filename parameter", got)
	}
	if strings.Contains(got, `filename="report"final.txt"`) {
		t.Fatalf("filename quote was not encoded: %q", got)
	}
}

func TestContentDispositionEscapesControlCharacters(t *testing.T) {
	got := contentDisposition("report\x00.txt")
	if strings.ContainsAny(got, "\x00\r\n") {
		t.Fatalf("Content-Disposition contains a raw control character: %q", got)
	}
	if !strings.Contains(got, "filename*=utf-8''report%00.txt") {
		t.Fatalf("Content-Disposition = %q, want RFC 5987 encoded filename", got)
	}
}
