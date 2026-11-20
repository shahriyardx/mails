// Package worker embeds the bundled Cloudflare Email Worker so the server
// can deploy it from the dashboard. Rebuild with: cd worker && pnpm build
package worker

import _ "embed"

// Script is dist/index.js, the worker as Cloudflare runs it.
//
//go:embed dist/index.js
var Script []byte
