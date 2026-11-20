#!/usr/bin/env bash
# Builds and publishes a release from this machine; GitHub builds nothing.
#
#   scripts/release.sh 0.1.5        (or: make release VERSION=0.1.5)
#
# Needs: go, pnpm, docker with buildx, gh (logged in), `docker login ghcr.io`,
# and the compose Postgres for the Go tests. `npm login` is optional: without
# it the Node SDK is skipped (publish it later with `make publish-sdk`).
#
# Steps: checks, tests, dashboard, server binaries (linux/darwin x
# amd64/arm64), extension zips, image (started once before it is pushed),
# git tag, GitHub release with the CHANGELOG section and the files, SDK.
# SKIP_TESTS=1 skips the tests. DRY_RUN=1 builds and checks everything,
# then stops before pushing, tagging or uploading anything.
set -euo pipefail

VERSION="${1:-${VERSION:-}}"
VERSION="${VERSION#v}"
TAG="v$VERSION"
IMAGE="${IMAGE:-ghcr.io/shahriyardx/mails}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/release"
cd "$ROOT"

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'release: %s\n' "$*" >&2; exit 1; }

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-].+)?$ ]] || die "give a version, e.g. scripts/release.sh 0.1.5"

say "Checks"
[ -z "$(git status --porcelain)" ] || die "commit or stash your changes first"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "release from main"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main is not in step with origin/main (push or pull first)"
grep -q "^## \[$VERSION\]" CHANGELOG.md || die "CHANGELOG.md has no '## [$VERSION]' section"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && [ "$(git rev-list -n1 "$TAG")" != "$(git rev-parse HEAD)" ]; then
  die "$TAG already exists on another commit"
fi
gh auth status >/dev/null 2>&1 || die "gh is not logged in (gh auth login)"
docker buildx version >/dev/null 2>&1 || die "docker buildx is missing"
[ "${DRY_RUN:-}" = 1 ] || python3 - <<'EOF' || die "docker is not logged in to ghcr.io (docker login ghcr.io -u <user>)"
import json, os, sys
d = json.load(open(os.path.expanduser("~/.docker/config.json")))
sys.exit(0 if "ghcr.io" in d.get("auths", {}) or "ghcr.io" in d.get("credHelpers", {}) else 1)
EOF

if [ "${SKIP_TESTS:-}" != 1 ]; then
  say "Tests"
  go vet ./...
  go test ./...
  (cd web && pnpm install --frozen-lockfile --ignore-scripts >/dev/null && pnpm test)
fi

say "Dashboard"
(cd web && pnpm install --frozen-lockfile --ignore-scripts >/dev/null && pnpm build)

say "Server binaries"
rm -rf "$OUT" && mkdir -p "$OUT/image"
for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64; do
  os=${target%/*}; arch=${target#*/}
  name="mails_${VERSION}_${os}_${arch}"
  mkdir -p "$OUT/$name"
  CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath -ldflags="-s -w" -o "$OUT/$name/mails" ./cmd/mails
  tar -C "$OUT/$name" -czf "$OUT/$name.tar.gz" mails
  if [ "$os" = linux ]; then mkdir -p "$OUT/image/linux-$arch" && cp "$OUT/$name/mails" "$OUT/image/linux-$arch/"; fi
done
(cd "$OUT" && sha256sum ./*.tar.gz | sed 's# \./# #' > checksums.txt)

say "Extension"
(
  cd packages/extension
  pnpm install --frozen-lockfile --ignore-scripts >/dev/null
  trap 'git checkout -- package.json' EXIT
  npm pkg set version="$VERSION"
  rm -rf .output
  pnpm zip:all >/dev/null
  cp .output/*.zip "$OUT/"
)

say "Image"
docker buildx inspect mails-builder >/dev/null 2>&1 || docker buildx create --name mails-builder --driver docker-container >/dev/null
docker buildx build --builder mails-builder --platform linux/amd64 -f Dockerfile.release -t mails:smoke --load "$OUT/image" >/dev/null
docker run --rm mails:smoke help >/dev/null || die "the image does not start"
if [ "${DRY_RUN:-}" = 1 ]; then
  say "Dry run done: files in $OUT; nothing was pushed"
  ls -1 "$OUT"
  exit 0
fi
tags=(-t "$IMAGE:$VERSION")
case "$VERSION" in *-*) ;; *) tags+=(-t "$IMAGE:latest" -t "$IMAGE:${VERSION%.*}") ;; esac
docker buildx build --builder mails-builder --platform linux/amd64,linux/arm64 -f Dockerfile.release \
  "${tags[@]}" --push "$OUT/image"

say "GitHub release $TAG"
if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  git tag -a "$TAG" -m "Mails $TAG"
  git push -q origin "$TAG"
fi
notes="$(awk -v v="$VERSION" '$0 ~ "^## \\[" v "\\]" {on=1; next} on && /^## \[/ {exit} on' CHANGELOG.md)
Image: \`$IMAGE:$VERSION\`"
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release edit "$TAG" --notes "$notes" >/dev/null
else
  gh release create "$TAG" --verify-tag --title "Mails $TAG" --notes "$notes" >/dev/null
fi
gh release upload "$TAG" "$OUT"/*.tar.gz "$OUT/checksums.txt" "$OUT"/*.zip --clobber

say "Node SDK"
if npm whoami >/dev/null 2>&1; then
  make publish-sdk VERSION="$VERSION"
else
  echo "npm is not logged in: skipped (later: npm login && make publish-sdk VERSION=$VERSION)"
fi

say "Done: $TAG, image $IMAGE:$VERSION"
