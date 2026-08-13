package handlers

import (
	"testing"

	"puremania/internal/types"
)

func TestFinishSearchPageUsesLastReturnedPathAsCursor(t *testing.T) {
	results := []types.FileInfo{{Path: "/a"}, {Path: "/b"}, {Path: "/c"}}
	page := finishSearchPage(results, 2)
	if !page.HasMore || page.NextCursor != "/b" || len(page.Data) != 2 {
		t.Fatalf("unexpected page: %#v", page)
	}
}

func TestBuildSearchMatcherRejectsInvalidRegex(t *testing.T) {
	_, err := buildSearchMatcher(searchRequest{Term: "[", UseRegex: true})
	if err == nil {
		t.Fatal("expected invalid regular expression to fail")
	}
}

func TestBuildSearchMatcherHonorsCaseSensitivity(t *testing.T) {
	insensitive, err := buildSearchMatcher(searchRequest{Term: "track"})
	if err != nil || !insensitive("Track.MP3") {
		t.Fatalf("case-insensitive matcher failed: %v", err)
	}
	sensitive, err := buildSearchMatcher(searchRequest{Term: "track", CaseSensitive: true})
	if err != nil || sensitive("Track.MP3") {
		t.Fatalf("case-sensitive matcher failed: %v", err)
	}
}
