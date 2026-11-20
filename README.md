# Mails

Self-hosted email for one person, on your own domains.

Mails sends through Amazon SES, receives through a Cloudflare Email Worker,
keeps mail in Postgres and attachments in Cloudflare R2. It is one Go binary
with the React dashboard embedded. Sign-in is GitHub only: the first GitHub
account to sign in owns the instance, and every other account is refused.
Sign-in is GitHub or nothing, and there is never a second user.

## Features

- **Mail:** send and receive, threads, full-text search, drafts, signatures,
  attachments, labels, filters, live updates.
- **Folders:** inbox, drafts, sent, archive, spam, trash. Mail that fails
  DMARC starts in spam.
- **Domains from the app:** add a domain, copy its DNS records (one DKIM TXT
  record, generated for you), watch it verify. Subdomains of a verified domain
  need nothing.
- **Receiving from the app:** paste a Cloudflare token, deploy the worker,
  turn receiving on per domain.
- **Mailboxes:** as many as you like, catch-all addresses, mailboxes created
  on first send or first receive.
- **Forwarding:** copies of inbound mail to outside addresses, by instance,
  domain or mailbox.
- **Delivery tracking:** SES events over SNS, delivered / bounced /
  complained / opened per message, automatic blocking of addresses that
  bounce or complain, a delivery log and metrics.
- **A send queue:** one attempt while you wait, then retries with backoff from
  a Postgres queue.
- **Public REST API** with scoped, mailbox-limited API keys, cursor
  pagination and idempotent sends.
- **Signed webhooks** with retries, a delivery log and replay.
- **Node SDK** (`@shahriyardx/mails`), a **browser extension**, and **Web
  Push** desktop notifications.

## Quick start

You need a GitHub OAuth app first: callback
`<APP_URL>/api/auth/callback/github` (for local use,
`http://localhost:3000/api/auth/callback/github`).

### Docker

```sh
cp .env.example .env                       # fill in GitHub OAuth + secrets
docker compose --profile app up -d --build
```

Postgres and the app start together; the app listens on `127.0.0.1:3000`.
Put a reverse proxy with TLS in front of it.

### From source

Needs Go, Node with pnpm, and Docker for Postgres.

```sh
docker compose up -d postgres              # Postgres 18 on 127.0.0.1:5437
cp .env.example .env                       # fill in GitHub OAuth + secrets
set -a; . ./.env; set +a; go run ./cmd/mails
```

The dashboard, with hot reload:

```sh
cd web && pnpm dev
```

Tests (need the compose Postgres):

```sh
go test ./...
```

Then open the app, sign in with GitHub, and follow the setup checklist. The
full walk-through, including SES and Cloudflare, is in
[Self-hosting it](web/src/docs/guide/self-hosting.md).

### Commands

```sh
mails              # run the server
mails migrate      # apply database migrations and exit
mails reset-owner  # remove the owner; the next GitHub sign-in claims the instance
mails vapid-keys   # print a VAPID key pair for Web Push
```

## Configuration

Everything is read from the environment at start. See `.env.example`.

| Variable | Required | Default | What it is |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | | Postgres connection string |
| `SECRET` | yes | | Encrypts stored secrets. `openssl rand -base64 32` |
| `GITHUB_CLIENT_ID` | yes | | GitHub OAuth app |
| `GITHUB_CLIENT_SECRET` | yes | | GitHub OAuth app |
| `INBOUND_WEBHOOK_SECRET` | yes | | Shared with the Cloudflare worker. `openssl rand -hex 32` |
| `APP_URL` | | `http://localhost:3000` | Public URL |
| `ADDR` | | `:3000` | Listen address |
| `AWS_REGION` | | `us-east-1` | SES region |
| `AWS_ACCESS_KEY_ID` | | | SES credentials. Empty uses the default AWS chain |
| `AWS_SECRET_ACCESS_KEY` | | | |
| `SES_CONFIGURATION_SET` | | | Attached to every send, for delivery events |
| `SES_SNS_TOPIC_ARN` | for delivery events | | The SNS topic SES publishes to. Without it `/api/ses/events` refuses everything |
| `SES_MAIL_FROM_PREFIX` | | `mail` | Return-path subdomain |
| `SES_DKIM_SELECTOR` | | `mail` | Selector for generated DKIM keys |
| `R2_ACCOUNT_ID` | in practice | | Cloudflare account id |
| `R2_ACCESS_KEY_ID` | in practice | | R2 API token |
| `R2_SECRET_ACCESS_KEY` | in practice | | |
| `R2_BUCKET` | | `mail-attachments` | Bucket for attachments and raw messages |
| `VAPID_PUBLIC_KEY` | | | Web Push. Generate with `mails vapid-keys` |
| `VAPID_PRIVATE_KEY` | | | |
| `VAPID_SUBJECT` | | `mailto:admin@localhost` | Contact for push services |
| `RUN_MIGRATIONS_ON_BOOT` | | `true` | Apply migrations on start |
| `OUTBOX_WORKER` | | `true` | Run the send queue in this process |

## Repository layout

```
cmd/mails/            main: config, DB, migrations, workers, HTTP server
internal/config       env vars (caarlos0/env)
internal/db           pgx pool, goose migrations (migrations/*.sql, embedded)
internal/db/dbtest    scratch database per test
internal/auth         GitHub OAuth, scs sessions, Require middleware, Claim()
internal/httpx        JSON/error helpers; errors match web/src/docs/api/errors.md
internal/id           prefixed random ids ("msg_...")
internal/realtime     SSE hub at /api/events
internal/server       chi router; route map in its package comment
internal/<feature>    one package per feature: domain, mailbox, inbound, mail,
                      send, delivery, cloudflare, forwarding, push, apikey,
                      apiv1, webhook, ...
web/                  React dashboard (Vite). web/embed.go embeds web/dist
web/src/docs/         docs markdown, rendered in the dashboard at /docs
worker/               Cloudflare Email Worker (TypeScript)
packages/sdk          Node SDK (TypeScript), @shahriyardx/mails
packages/extension    Browser extension (WXT), "Mails"
specs/                design spec
```

## Documentation

The docs ship inside the app at `/docs`. The same pages, in this repository:

- [What it is](web/src/docs/guide/index.md)
- [How it fits together](web/src/docs/guide/architecture.md)
- [Self-hosting it](web/src/docs/guide/self-hosting.md)
- [Sending domains](web/src/docs/guide/domains.md) and
  [receiving mail](web/src/docs/guide/receiving.md)
- [Using the API](web/src/docs/api/index.md)
- [Webhooks](web/src/docs/webhooks/index.md)
- [The Node SDK](web/src/docs/sdk/index.md)

## License

PolyForm Noncommercial 1.0.0: free for personal projects, research,
education and charitable work. Any use by or for a business needs a separate
commercial licence; write to mdshahriyaralam552@gmail.com. See
[LICENSE](LICENSE).

The Node SDK in `packages/sdk` is MIT.
