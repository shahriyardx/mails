# Changelog

All notable changes are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.3] - 2026-11-27

Upgrading: nothing to do. Click **Reload** when Mails offers the new version.

### Fixed

- On screens narrower than 1280px, an open conversation takes the full width
  next to the sidebar instead of a narrow third column. The back arrow returns
  to the list.
- The toolbar above a conversation stays on one row on phones and narrow
  windows. Long mailbox names are shortened; labels show on their own row.

## [0.3.2] - 2026-11-27

Upgrading: no migrations. To fix a domain whose DKIM record was deleted, set
`SES_DKIM_SELECTOR` if you want a selector other than `mail`, deploy, then
click **Generate new DKIM key** on the domain and publish its TXT record at once.

### Added

- **Generate new DKIM key** on an imported domain whose key was set up
  elsewhere. Use it when that DKIM record was lost or deleted.

## [0.3.1] - 2026-11-22

Upgrading: no config or migrations. Your `VAPID_SUBJECT` can stay as it is.
After the deploy, press **Send a test** in Settings → Notifications.

### Fixed

- Web push to iPhone, iPad and Safari on Mac: a `VAPID_SUBJECT` that starts
  with `mailto:` was sent as `mailto:mailto:…`, and Apple rejected every
  notice. Failed sends are now logged with the push service and status.
- The iPhone notice says any browser can add Mails to the Home Screen, not
  only Safari.

## [0.3.0] - 2026-11-22

Upgrading: after the deploy, open Mails once and click **Reload** when it
offers the new version. Nothing else to do; no migrations.

### Added

- Install Mails as an app (PWA) on desktop and phone, with the folded-diamond
  icon. The app opens with no connection.
- Offline reading: lists and conversations you opened, plus the newest 50
  Inbox conversations, are saved on the device (IndexedDB). Sender pictures
  and opened attachments are saved too.
- Archive, Trash, Star, Read, Labels and Snooze work offline. They wait on
  the device, also across a reload, and run when the connection is back.
- An "Offline · showing saved mail" note, and a "New version · Reload"
  message instead of silent updates.
- Docs: Guide → Install and offline use.
- iPhone and iPad: Settings → Notifications says to add Mails to the Home
  Screen first, instead of "This browser cannot show push notifications".

### Changed

- Sign-out, or a 401 from the server, deletes the mail saved on the device.
- The server sends `sw.js` and `manifest.webmanifest` with `no-cache`.
- Sending, search and settings fail at once offline with a clear error;
  nothing is sent later without you.

## [0.2.0] - 2026-11-21

Upgrading: migration 0014 runs `CREATE EXTENSION pg_trgm`. Hosted Postgres
allows it for the database owner; if yours does not, enable it once as a
superuser before starting 0.2.0.

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
- Undo send: a message sent from the dashboard waits a few seconds
  (Settings -> Preferences -> Undo send: off, 5, 10, 20 or 30; 10 by
  default) with a "Sending… Undo" note. Undo brings it back as a draft,
  files and all. API sends still go at once. `POST /emails/:id/cancel`
  inside the window turns the message back into a draft.
- Search filters: `from:`, `to:`, `subject:`, `has:attachment`,
  `is:unread` / `is:read` / `is:starred`, `label:`, `in:<folder>`,
  `before:` / `after:` (YYYY-MM-DD), with "quoted values". They work in the
  dashboard search box (shown as removable chips, with a Filters list) and
  in `q` on `/api/v1/threads`, `/messages` and `/emails`. Free text now
  also matches part of the sender or subject on messages. New indexes
  (migration 0014, enables `pg_trgm`) keep each filter on an index.
- Snooze: put a conversation away until later today, tomorrow, next week
  or a date and time (button next to Archive, on a row's hover actions, or
  `b` in the list and in a conversation). It leaves the Inbox and its
  count, shows under the new Snoozed folder, and comes back to the Inbox
  unread when the time comes (with a push notice), or at once when new
  mail arrives in it. `PATCH /threads/:id` takes `snoozed_until`
  (RFC 3339 or null), threads carry it, and `folder=snoozed` lists them.
- Composer: drag files onto it to attach them ("Drop to attach"), or paste
  files and screenshots from the clipboard. Same upload, limits and errors
  as the paperclip.

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

[Unreleased]: https://github.com/shahriyardx/mails/compare/v0.3.3...HEAD
[0.3.3]: https://github.com/shahriyardx/mails/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/shahriyardx/mails/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/shahriyardx/mails/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/shahriyardx/mails/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/shahriyardx/mails/compare/v0.1.8...v0.2.0
[0.1.8]: https://github.com/shahriyardx/mails/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/shahriyardx/mails/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/shahriyardx/mails/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/shahriyardx/mails/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/shahriyardx/mails/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/shahriyardx/mails/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/shahriyardx/mails/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/shahriyardx/mails/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/shahriyardx/mails/releases/tag/v0.1.0
