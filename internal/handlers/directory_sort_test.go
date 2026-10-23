package handlers

import (
	"reflect"
	"slices"
	"sort"
	"strings"
	"testing"

	"puremania/internal/types"
)

func TestSortedFilePageMatchesStableOrdering(t *testing.T) {
	files := append(benchmarkFileList(137),
		types.FileInfo{Name: "Äpfel", Path: "/Äpfel", Size: -1, IsDir: true},
		types.FileInfo{Name: "äPFEL", Path: "/äPFEL", Size: 1<<63 - 1},
		types.FileInfo{Name: "Photo-000000.JPG", Path: "/album/Photo-000000.JPG", Size: 0, IsEditable: true},
	)
	original := slices.Clone(files)
	for _, field := range []string{"name", "size", "modified", "type", "unknown", ""} {
		for _, direction := range []string{"asc", "desc"} {
			t.Run(field+"/"+direction, func(t *testing.T) {
				want := slices.Clone(files)
				sort.SliceStable(want, func(i, j int) bool {
					left, right := want[i], want[j]
					var comparison int
					switch field {
					case "size":
						comparison = compareInt64(left.Size, right.Size)
					case "modified":
						comparison = strings.Compare(left.ModTime, right.ModTime)
					case "type":
						comparison = strings.Compare(fileSortType(left), fileSortType(right))
					default:
						comparison = strings.Compare(strings.ToLower(left.Name), strings.ToLower(right.Name))
					}
					if comparison == 0 {
						comparison = strings.Compare(left.Path, right.Path)
					}
					if direction == "desc" {
						return comparison > 0
					}
					return comparison < 0
				})
				for start := 0; start <= len(files); start += 10 {
					end := min(start+10, len(files))
					got := sortedFilePage(files, field, direction, start, end)
					if !reflect.DeepEqual(got, want[start:end]) {
						t.Fatalf("page %d:%d differs from stable ordering", start, end)
					}
				}
				if !reflect.DeepEqual(files, original) {
					t.Fatal("sorting mutated the shared cache")
				}
			})
		}
	}
	if got := sortedFilePage(nil, "name", "asc", 0, 0); got != nil {
		t.Fatalf("empty directory representation changed: %v", got)
	}
}
