# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Keyboard in the mail list: one Tab stop for the whole list; Up/Down
  (or j/k) move between emails and, side by side, open them; Home/End
  jump; Enter opens; x selects, e archives, s stars, u toggles read, and
  Backspace / Delete / # move to Trash. With emails selected, these keys
  act on all of them.
- Keyboard in an open conversation: r reply, a reply all, f forward,
  j / k the next / previous conversation in the list, Escape back to the
  list, e archive, # / Backspace / Delete move to Trash, s star, u mark
  unread and go back. Works with focus in the mail body too.
- After archiving, deleting, moving or reporting spam from an open
  conversation, the next one in the list opens (the one below, else the
  one above). Settings -> Preferences -> "After archiving or deleting"
  switches to going back to the list instead (saved in this browser).
- The browser tab shows the unread Inbox count and the open view, like
  "(3) Inbox · Mails", with a dot on the tab icon while anything is
  unread. Settings and docs pages show their page title.
- Command menu: Ctrl+K (Cmd+K on a Mac) opens a search box to jump to a
  folder, mailbox, domain, label, settings page or the docs, write a
  message, switch the theme, fold the sidebar, or search mail. Arrow keys
  and Enter pick; letters typed in order match ("strd" finds Starred).
- Docs: Guide -> Keyboard shortcuts lists every key.

## [0.1.8] - 2026-11-21

### Changed

- Conversation header: where you are on the left (back, folder, mailbox,
  labels) and the actions as icons on the right, under one line.
- Settings in the sidebar and account menu opens Domains directly.
- Sidebar: folders (Inbox, Starred, Sent, ...) show their icon next to
  the name.
- Sidebar: mailboxes under a domain show just their name ("billing"),
  without a trailing "@"; the full address is in the tooltip.

## [0.1.7] - 2026-11-21

### Fixed

- "One at a time" reading layout: an open conversation shows a Back
  button at every screen width (it was shown only on small screens).

### Changed

- Folded sidebar: the Mailboxes and Labels groups are hidden (a column of
  coloured squares said nothing); they show again when it is opened.

## [0.1.6] - 2026-11-21

### Changed

- Sidebar: each domain's mailboxes fold away with an arrow. A folded
  domain shows its total unread count and stays open while one of its
  mailboxes is open; the choice is kept per browser.
- Mail list: the filter chips are only All and Unread (the sidebar picks
  the mailbox) and work within the mailbox picked there.
- The source-built image uses Node 26; CI uses current GitHub Actions.

## [0.1.5] - 2026-11-21

### Fixed

- The 0.1.4 image could not start ("exec /mails failed: Permission
  denied"): the binary lost its exec bit between release jobs. The image
  now sets it, and the release starts the image before pushing it.

### Changed

- Releases are built and published from a local machine with
  `make release VERSION=x.y.z`; GitHub Actions only runs CI.

## [0.1.4] - 2026-11-21

### Fixed

- Settings -> Inbound: when Cloudflare refuses a routing step, the error
  names the one permission that step needs.

### Changed

- Releases build every binary once and the image copies them in, so
  publishing takes minutes. Build jobs run read-only; only the publish
  jobs hold write tokens.
- `make push-image` and `make publish-sdk` publish the image and the Node
  SDK from a terminal.

## [0.1.3] - 2026-11-21

### Changed

- The release image builds for arm64 by cross-compiling instead of
  emulation, so releases publish in minutes. Same code as 0.1.2.

## [0.1.2] - 2026-11-21

### Fixed

- Errors from Cloudflare and SES (for example a rejected token) now reach
  the dashboard with their message behind a proxy such as Cloudflare,
  instead of showing "Request failed (502)".

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

[Unreleased]: https://github.com/shahriyardx/mails/compare/v0.1.8...HEAD
[0.1.8]: https://github.com/shahriyardx/mails/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/shahriyardx/mails/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/shahriyardx/mails/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/shahriyardx/mails/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/shahriyardx/mails/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/shahriyardx/mails/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/shahriyardx/mails/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/shahriyardx/mails/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/shahriyardx/mails/releases/tag/v0.1.0
