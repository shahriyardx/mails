// Package web embeds the built React app (web/dist) into the binary.
// `pnpm --filter web build` writes dist; a placeholder index.html is committed
// so `go build` works before the first frontend build.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Dist returns the built files rooted at dist/.
func Dist() fs.FS {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		panic(err)
	}
	return sub
}
