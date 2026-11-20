# Common tasks. Needs Go, pnpm and the compose Postgres for tests.
.PHONY: help dev build web test lint fmt docker release push-image publish-sdk clean

IMAGE ?= ghcr.io/shahriyardx/mails
# Version to tag the image with; defaults to the latest git tag (v1.2.3 -> 1.2.3).
VERSION ?= $(patsubst v%,%,$(shell git describe --tags --abbrev=0))

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

release: ## Build and publish release VERSION from this machine (scripts/release.sh; DRY_RUN=1 to try)
	scripts/release.sh $(VERSION)

push-image: web ## Build Linux binaries here and push the image to ghcr (run `docker login ghcr.io` first)
	@test -n "$(VERSION)" || (echo "No version: tag a release or pass VERSION=1.2.3"; exit 1)
	for arch in amd64 arm64; do \
		CGO_ENABLED=0 GOOS=linux GOARCH=$$arch go build -trimpath -ldflags="-s -w" -o dist/image/linux-$$arch/mails ./cmd/mails || exit 1; \
	done
	docker buildx inspect mails-builder >/dev/null 2>&1 || docker buildx create --name mails-builder --driver docker-container
	docker buildx build --builder mails-builder --platform linux/amd64,linux/arm64 -f Dockerfile.release \
		-t $(IMAGE):$(VERSION) -t $(IMAGE):latest --push dist/image

publish-sdk: ## Test and publish the Node SDK to npm at VERSION (run `npm login` first)
	@test -n "$(VERSION)" || (echo "No version: tag a release or pass VERSION=1.2.3"; exit 1)
	@npm whoami >/dev/null 2>&1 || (echo "Not logged in to npm: run npm login"; exit 1)
	cd packages/sdk && pnpm install --frozen-lockfile --ignore-scripts && pnpm typecheck && pnpm test
	cd packages/sdk && npm pkg set version=$(VERSION) && npm publish --access public; \
		status=$$?; git checkout -- package.json; exit $$status

clean: ## Remove build output
	rm -rf bin dist
	find web/dist -mindepth 1 ! -name .keep -delete
