# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-11-21

### Fixed

- Settings -> Inbound accepts Cloudflare tokens made on the Account API
  tokens page (account-owned tokens), not only user tokens.

## [0.1.0] - 2026-11-21

First release of Mails, the Go rewrite.

### Added

- Single Go binary with the React dashboard built in; Postgres for mail, R2
  for attachments.
- Sending through Amazon SES with a database send queue, drafts, replies and
  forwards; receiving through a Cloudflare Email Worker deployed from the
  dashboard.
- Threads, labels, filters, forwarding, search, image trust and push
  notifications.
- Domains with DKIM, MAIL FROM and DNS checks; delivery tracking for
  bounces, complaints and opens.
- Public REST API with scoped keys, idempotency and rate limits; signed
  webhooks with retries; Node SDK; browser extension for Chrome, Firefox and
  Edge.
- Dark and light themes, sender pictures (Gravatar, brand logos, site icons)
  and a sidebar that folds down to icons.
- Release workflow publishing the image to `ghcr.io`, server binaries and
  extension zips.

### Fixed

- Two rounds of bug review before release: mail that could not be received
  (NUL bytes, a trailing backslash in the subject, an empty From), double
  sends (composer, SDK reply retries, client hang-ups, shutdown), lost
  drafts and composer text, drafts trashed mid-send, shared attachments
  deleted with one copy, reply threading outside us-east-1, API key reach on
  subdomains, live updates that stopped after an error, and more. Every fix
  has a test.

[Unreleased]: https://github.com/shahriyardx/mails/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/shahriyardx/mails/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/shahriyardx/mails/releases/tag/v0.1.0
