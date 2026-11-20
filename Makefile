# Common tasks. Needs Go, pnpm and the compose Postgres for tests.
.PHONY: help dev build web test lint fmt docker clean

help: ## Show this list
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-8s %s\n", $$1, $$2}'

web: ## Build the dashboard into web/dist
	cd web && pnpm install --frozen-lockfile && pnpm build

build: web ## Build bin/mails with the dashboard embedded
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/mails ./cmd/mails

dev: build ## Build, then run with .env
	set -a; . ./.env; set +a; ./bin/mails

test: ## Go vet and tests, dashboard tests
	go vet ./...
	go test ./...
	cd web && pnpm test

lint: ## gofmt, staticcheck, Biome, TypeScript
	@test -z "$$(gofmt -l ./cmd ./internal)" || (gofmt -l ./cmd ./internal; exit 1)
	go run honnef.co/go/tools/cmd/staticcheck@latest ./...
	cd web && pnpm exec tsc -b && pnpm lint

fmt: ## Format Go and dashboard code
	gofmt -w ./cmd ./internal
	cd web && pnpm format

docker: ## Build the Docker image as mails:dev
	docker build -t mails:dev .

clean: ## Remove build output
	rm -rf bin
	find web/dist -mindepth 1 ! -name .keep -delete
