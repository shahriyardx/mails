## What and why

<!-- One or two sentences. Link the issue if there is one: Fixes #123 -->

## How it was tested

<!-- Commands you ran, screens you checked (dark and light, phone width for UI). -->

## Checklist

- [ ] `go test ./...` and `go vet ./...` pass (needs the compose Postgres)
- [ ] `cd web && pnpm exec tsc -b && pnpm lint && pnpm test` pass, if the dashboard changed
- [ ] New behaviour has a test; migrations are new files, never edits to old ones
- [ ] Docs in `web/src/docs` updated, if users or API callers see the change
