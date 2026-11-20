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
cmd/mails/            main: wiring, workers, HTTP server; commands.go: migrate, reset-owner, vapid-keys
internal/config       env vars (caarlos0/env)
internal/db           pgx pool, Querier, goose migrations (migrations/*.sql, embedded)
internal/db/dbtest    scratch database per test
internal/auth         GitHub OAuth, scs sessions, Require middleware, Claim()
internal/httpx        JSON/error helpers, Bind/Validate (validator), Opt[T] for PATCH
internal/id           prefixed random ids ("msg_...")
internal/addr         address/domain/subject parsing, snippets (one source of truth)
internal/page         cursor pagination ("<micros>|<id>"), list shape
internal/events       Event + Sink interface (webhooks listen); Recorder for tests
internal/realtime     SSE hub at /api/events
internal/server       chi router; route map in its package comment
internal/ses          SES v2 client interface + AWS impl; ses/sesfake for tests
internal/storage      R2 Store interface (streaming), Memory store for tests/dev
internal/secret       AES-GCM box keyed from SECRET (Cloudflare token at rest)
internal/safehttp     HTTP client/URL check refusing private addresses (webhooks, push)
internal/domain       sending domains: SES identity, BYODKIM, MAIL FROM, DNS records
internal/mailbox      mailboxes, default, create-on-send
internal/inbound      POST /api/inbound: verify, store, thread, filters, forward answer
internal/forwarding   forward targets (inbound) + destination/rule management
internal/mail         threads, messages, folder moves, labels, filters, contacts,
                      attachments, image trust, preferences, Recompute
internal/send         compose/send, MIME (go-mail), drafts, replies, outbox worker
internal/delivery     /api/ses/events (SNS verify), blocked list, log, metrics, overview
internal/cloudflare   token, worker deploy, routing, subdomain MX; cffake for tests
internal/push         web push (webpush-go)
internal/setup        first-run wizard state (settings row)
internal/apikey       keys (sha256), scopes, presets, reach
internal/idempotency  Idempotency-Key replay with advisory lock
internal/webhook      signed delivery, retries, endpoint management
internal/apiv1        /api/v1 handlers: auth, rate limit (httprate), scope + reach checks
web/                  React dashboard (Vite). web/embed.go embeds web/dist
web/src/docs/         docs markdown + nav.json, rendered in the dashboard at /docs
worker/               Cloudflare Email Worker; `pnpm build` writes dist/index.js,
                      embedded by worker/embed.go and deployed from the dashboard
packages/sdk          Node SDK @shahriyardx/mails
packages/extension    Browser extension "Mails" (WXT)
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

## Status (2026-11-20, overnight build)

Done (all with Go tests against scratch Postgres; `go test ./...`,
`go vet ./...` and staticcheck clean):
- Steps 1-8: domains, mailboxes, inbound, mail, send + outbox, delivery
  events, Cloudflare + forwarding, push, setup wizard, API keys, idempotency,
  rate limits, webhooks, every `/api/v1` route.
- Step 9: dashboard in web/ (Vite, React 19, Base UI kit, soothing-dark
  tokens with a contrast test, mail screens, composer, every settings page,
  /docs viewer, push service worker). `cd web && pnpm test` (150 tests).
- Step 10: worker/SDK/extension renamed to Mails; worker auth headers and
  extension remote-content blocking hardened (see worker/PAYLOAD.md).
- Step 11: Dockerfile (distroless), compose `app` profile, README, docs.
- Security fixes from review: threading cannot be hijacked by subject or a
  leaked Message-ID; SNS needs SES_SNS_TOPIC_ARN; webhook/push URLs cannot
  reach private networks; restricted API keys cannot widen their reach.

Notes:
- Idle memory: about 15 MB private (docker stats 15.7 MiB) plus mapped
  binary pages (shared, reclaimable). Image 109 MB. cloudflare-go v6's root package pulls
  every Cloudflare service in; dropping it would shrink the binary most.
- WORKER_TRUST_AUTH_RESULTS (env) is off by default, so spf/dkim/dmarc are
  null until the owner confirms Cloudflare writes the topmost header.
- Not built: the "Reporting" page (SES configuration-set setup from the
  dashboard). Set the configuration set and SNS topic in AWS by hand; see
  web/src/docs/guide/self-hosting.md.

Still to verify by hand on the real setup: send one mail through SES and
receive one through the worker (needs real AWS, Cloudflare and R2 keys).
