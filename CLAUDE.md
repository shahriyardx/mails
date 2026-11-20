# Mails

Self-hosted email for one person. Go server + embedded React dashboard, one
binary. Sends through Amazon SES, receives through a Cloudflare Email Worker,
stores mail in Postgres and attachments in Cloudflare R2. Public REST API,
webhooks, a Node SDK and a browser extension.

**Read first:** `specs/2026-11-20-mails-design.md`. Its top section ("Go
rewrite") overrides the rest. Scope (what stays, what goes), the API list and
the UI system are decided there. Do not re-ask the owner about them.

## The owner

- Wants plain, short answers (ELI5 output style). Paths and commands exact.
- Said "start building, no questions asked": make sensible calls and report
  them, do not stop to ask.
- Wants well-known, maintained libraries instead of hand-rolled code.
- Wants the least RAM possible. Today the binary idles at ~22 MB.

## Engineering bar

Work like a senior engineer on a Google-quality codebase:

- **Design systems:** use the best-in-class, maintained design system and
  libraries for each job. Never hand-roll what a well-known library does.
- **Structure:** package by feature (`internal/<feature>`), not by layer. Each
  package has one job and a small exported surface. Handlers stay thin; logic
  lives in service functions that take plain inputs and return plain values.
- **DRY:** one source of truth for each rule (scopes, folder moves, address
  parsing, error shapes, serialization). `/api/app` and `/api/v1` call the
  same service functions. UI parts come from one kit.
- **Testable:** dependencies come in through interfaces or constructor
  arguments (SES sender, R2 store, clock, HTTP client), so tests use fakes,
  never real AWS or Cloudflare. Table-driven tests. Every branch that moves
  money, mail or permissions has a test.
- **Performance and RAM:** small pool, no per-request goroutine leaks, stream
  large bodies (attachments, raw MIME) instead of buffering, index every
  query path, paginate with cursors, no N+1 queries.
- **Scalability:** stateless HTTP handlers; background work through the DB
  queue (`send_job`, webhook retries) with `FOR UPDATE SKIP LOCKED`, so a
  second process could run later without changes.
- **Errors and logs:** wrap errors with context (`fmt.Errorf("...: %w")`),
  `log/slog` structured logs, never log secrets or mail bodies.
- **Security:** validate at every trust boundary (worker, SNS, API keys,
  session), constant-time secret compares, sanitize mail HTML before render.

## Reference implementation

`/home/shahriyar/dev/next/mail` is Mailroom, the full Next.js app this is cut
down from. **Never edit it.** Read it to copy behaviour:

| Need | Read in `../mail` |
| --- | --- |
| Worker -> app inbound payload | `worker/src/index.ts`, `src/app/api/inbound/route.ts`, `src/server/ingest.ts`, `src/server/inbound.ts` |
| Threading, folders, trash, labels | `src/server/threads.ts`, `aggregate.ts`, `trash.ts`, `labels.ts` |
| Sending, MIME, queue | `src/server/send.ts`, `outbox.ts`, `sent.ts`, `src/lib/mime.ts`, `src/lib/ses.ts` |
| SES/SNS delivery events | `src/app/api/ses/events/route.ts`, `src/lib/sns.ts`, `src/lib/ses-events.ts` |
| Domains, DKIM, DNS checks | `src/server/domains.ts`, `src/lib/dkim.ts` |
| Cloudflare worker deploy, routing, forwarding | `src/lib/cloudflare.ts`, `src/server/integrations.ts`, `src/server/forwarding.ts` |
| Public API, keys, scopes, idempotency | `src/app/api/v1/**`, `src/server/api-auth.ts`, `api-send.ts`, `api-serialize.ts`, `idempotency.ts`, `src/lib/api-scopes.ts` |
| Webhooks | `src/server/webhooks.ts`, `src/lib/webhook-events.ts` |
| Push | `src/server/push.ts` |
| Screens | `src/components/mail/*.tsx`, `src/app/(mail)/**` |

Skip everything about organizations, members, teams, roles, invitations,
access grants, campaigns, lists, broadcasts, automations, custom events,
media, templates, scheduled send, test-mode keys and send-rate limits.

## Layout

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
web/                  React dashboard (Vite). web/embed.go embeds web/dist
web/src/docs/         docs markdown, rendered in the dashboard at /docs
worker/               Cloudflare Email Worker (TypeScript, copied from ../mail)
packages/sdk          Node SDK (TypeScript), to rename to @shahriyardx/mails
packages/extension    Browser extension (WXT), to rename to "Mails"
specs/                design spec
```

New server features go in their own package under `internal/` (for example
`internal/mail`, `internal/send`) exposing `Routes(d *server.Deps) http.Handler`
or plain functions, and get mounted in `internal/server/server.go`. Keep
service functions (DB logic) separate from HTTP handlers so `/api/app` and
`/api/v1` share them.

## Libraries

In use: `go-chi/chi/v5`, `jackc/pgx/v5`, `pressly/goose/v3`,
`caarlos0/env/v11`, `alexedwards/scs/v2` + `pgxstore`,
`golang.org/x/oauth2`, `google/go-github/v93`.

Use these for what is left:

- SES and R2: `aws/aws-sdk-go-v2` (`service/sesv2`, `service/s3` with the R2
  endpoint, `feature/s3/manager`, S3 presign).
- Reading inbound MIME: `emersion/go-message`. Building outbound MIME:
  `wneessen/go-mail` (write to a buffer, send raw through SES).
- Cloudflare API (worker upload, Email Routing, destinations):
  `cloudflare/cloudflare-go/v6` (official).
- Web push: `SherClockHolmes/webpush-go`.
- Request validation: `go-playground/validator/v10`.
- API rate limits: `go-chi/httprate`.
- HTML sanitizing on the server, if needed: `microcosm-cc/bluemonday`.
- DB queries: hand-written SQL with pgx v5 (`pgx.CollectRows`,
  `pgx.RowToStructByName`). No ORM, no codegen.
- Secrets at rest (Cloudflare token): stdlib AES-GCM keyed from `SECRET`.
- SNS signature check: no maintained Go library exists; verify with stdlib
  `crypto/x509` (fetch the cert only from `sns.<region>.amazonaws.com`).

Dashboard: Vite, React 19, TypeScript, Tailwind 4, `@base-ui/react`,
`motion`, `@tanstack/react-query`, `react-router`, `sonner`, `dompurify`,
`class-variance-authority`, `tailwind-merge`, `clsx`, Material Symbols
Rounded (self-hosted font), Google Sans Flex. Docs rendering:
`react-markdown` + `remark-gfm`.

## Running

```sh
docker compose up -d postgres          # Postgres 18 on 127.0.0.1:5437
cp .env.example .env                   # fill in GitHub OAuth + secrets
set -a; . ./.env; set +a; go run ./cmd/mails
go test ./...                          # needs the compose Postgres
```

Tests make a scratch database each (`dbtest.New(t)`) and skip when Postgres
is not running. Port 5433 belongs to another project on this machine.

## Status (2026-11-20)

Done:
- Repo created; worker, SDK, extension copied; docs moved to `web/src/docs`
  (pages for removed features deleted).
- Full schema (`0001_init.sql`), goose migrations on boot.
- GitHub sign-in, single owner, second account refused, race-safe first
  claim, sessions. Tests: `internal/auth/auth_test.go` (4 passing).
- chi router, SSE hub, SPA serving, health check. Binary builds and boots.

Next, in this order:
1. `internal/domain` + `internal/mailbox`: SES identities, DKIM, DNS checks, mailbox CRUD.
2. `internal/inbound`: `POST /api/inbound` (shared secret), ingest, threading, filters, forwarding answer, spam folder.
3. `internal/mail`: threads, messages, folders, search, star/read/move/trash, labels, contacts, image trust, preferences, attachments (R2 presigned download, upload).
4. `internal/send`: compose, drafts, signatures, MIME, outbox worker (retry/backoff), SES send.
5. `internal/delivery`: `/api/ses/events` (SNS), message events, suppressions, logs, metrics, overview.
6. `internal/cloudflare`: token integration, worker deploy, routing, forward destinations.
7. `internal/push`, setup wizard state (`settings` table).
8. `internal/apiv1`: API keys (hash, scopes, reach), idempotency, rate limit, all `/api/v1` routes per `web/src/docs/api/*.md`, webhooks with signed delivery and retry worker.
9. `web/`: Vite app, UI kit on Base UI with the soothing-dark tokens from the spec, port screens from `../mail`, `/docs` viewer.
10. Rename worker/SDK/extension to Mails; SDK drops templates.
11. Dockerfile (multi-stage, distroless static), README, self-hosting doc.

Each step: tests first for the logic, `go vet ./...`, `go test ./...`, commit.
