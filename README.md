# Mails

Self-hosted email for one person, on your own domains.

Mails sends through Amazon SES, receives through a Cloudflare Email Worker,
and keeps mail in Postgres and attachments in Cloudflare R2. It ships as one
Go binary with the dashboard built in. You sign in with GitHub, and the first
account to sign in owns the instance.

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

## Development

Needs Go 1.27, Node 22 with pnpm, and Docker.

```sh
docker compose up -d postgres
set -a; . ./.env; set +a
go run ./cmd/mails                # server on :3000
cd web && pnpm install && pnpm dev # dashboard with hot reload
go test ./...                     # needs the compose Postgres
```

## Documentation

The full guide and API reference live in [`web/src/docs`](web/src/docs) and
are served by the app at `/docs`. Self-hosting starts at
[`guide/self-hosting`](web/src/docs/guide/self-hosting.md).

## License

[PolyForm Noncommercial 1.0.0](LICENSE)
