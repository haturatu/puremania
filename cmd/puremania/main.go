package main

import (
	"os"

	"puremania/internal/app"
)

func main() {
	os.Exit(app.Run(os.Args[1:]))
}
