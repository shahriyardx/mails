# Contributing

Thanks for helping. Small, focused pull requests are easiest to review.

## Before you start

- Bugs and small fixes: open a pull request directly.
- Larger changes or new features: open an issue first, so we can agree on the
  approach before you spend time on it.
- Security problems: do not open an issue. See [SECURITY.md](SECURITY.md).

Mails is licensed under [PolyForm Noncommercial 1.0.0](LICENSE). By
contributing, you agree that your contribution is licensed the same way.

## Set up

You need Go 1.27, Node 22 with pnpm, and Docker.

```sh
docker compose up -d postgres     # Postgres 18 on 127.0.0.1:5437
cp .env.example .env              # fill in at least the required values
make dev                          # server on :3000 with the built dashboard
cd web && pnpm install && pnpm dev  # dashboard with hot reload (proxies /api)
```

`mails seed-demo` adds demo mail to look at; `mails seed-demo --remove` takes
it out again.

## Checks

Run these before you push. CI runs the same.

```sh
make test     # Go: vet, tests (scratch database per test), dashboard tests
make lint     # gofmt, staticcheck, Biome
```

For the other parts, run `pnpm typecheck && pnpm test` in
`packages/extension`, `packages/sdk` or `worker`.

## How the code is laid out

- One package per feature under `internal/` (for example `internal/send`).
  Handlers stay thin; service functions take plain inputs and return plain
  values, so `/api/app` and `/api/v1` share them.
- Dependencies (SES, R2, Cloudflare, clock, HTTP) come in through interfaces,
  so tests use fakes and never touch real services.
- SQL is hand-written with pgx. Schema changes are new numbered files in
  `internal/db/migrations`; never edit one that has shipped.
- The dashboard uses the components in `web/src/components/kit`. Follow
  [docs/design.md](docs/design.md) for look and wording.

## Commits and pull requests

- Commit messages: short imperative subject (`fix: keep drafts editable`),
  with a body when the reason is not obvious.
- One topic per pull request. Include a test for new behaviour, and update
  `web/src/docs` when users or API callers see the change.
- UI changes: add a screenshot, and check dark mode, light mode and phone width.
