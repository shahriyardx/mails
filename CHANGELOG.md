# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/shahriyardx/mails/commits/main
