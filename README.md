# Mails

[![CI](https://github.com/shahriyardx/mails/actions/workflows/ci.yml/badge.svg)](https://github.com/shahriyardx/mails/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/shahriyardx/mails?include_prereleases&sort=semver)](https://github.com/shahriyardx/mails/releases)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-a99cf5)](LICENSE)

Your own email platform, on your own domains.

Mails sends through Amazon SES, receives through Cloudflare Email Routing,
and keeps your mail in your own Postgres and R2. It ships as a single Go
binary with the dashboard built in. Private by design: you sign in with
GitHub, and the instance is yours alone.

## Features

- Inbox, threads, search, drafts, labels, filters and forwarding
- Domains, DNS records and Cloudflare receiving, all set up from the dashboard
- Delivery tracking: bounces, complaints and opens
- REST API, signed webhooks, a Node SDK and a browser extension

## Quick start

```sh
cp .env.example .env              # fill in GitHub, AWS, Cloudflare R2 and secrets
docker compose --profile app up -d
```

Open `APP_URL` and sign in with GitHub. The setup page walks you through the
rest.

Each release publishes the image `ghcr.io/shahriyardx/mails` (`:latest` or a
version such as `:1.2.0`), server binaries and the browser extension zips on
the [releases page](https://github.com/shahriyardx/mails/releases).

## Development

Needs Go 1.27, Node 22 with pnpm, and Docker.

```sh
docker compose up -d postgres
make dev                          # build and run on :3000
cd web && pnpm install && pnpm dev # dashboard with hot reload
make test                         # needs the compose Postgres
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. Report security
problems privately, as described in [SECURITY.md](SECURITY.md).

## Documentation

The full guide and API reference live in [`web/src/docs`](web/src/docs) and
are served by the app at `/docs`. Self-hosting starts at
[`guide/self-hosting`](web/src/docs/guide/self-hosting.md).

## License

[PolyForm Noncommercial 1.0.0](LICENSE)
