package middleware

import "testing"

func FuzzSelectContentEncoding(f *testing.F) {
	for _, seed := range []string{"gzip, br", "br;q=0, gzip;q=1", "gzip;q=0.5, *;q=0.2", "\x00\r\n"} {
		f.Add(seed)
	}
	f.Fuzz(func(_ *testing.T, value string) {
		encoding := selectContentEncoding(value)
		if encoding != "" && encoding != "br" && encoding != "gzip" {
			panic("unexpected content encoding")
		}
	})
}
