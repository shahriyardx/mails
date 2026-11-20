# Mails — design

Date: 2026-11-20
Source: `/home/shahriyar/dev/next/mail` (Mailroom 0.3.1, commit `3adf354`)
Target: `/home/shahriyar/dev/next/mails`

## Update 2026-11-20: Go rewrite (this section wins over anything below)

The owner chose a Go server instead of cutting down the Next.js app, for the
least RAM in one deployable binary. What changed:

- Server: Go, one binary (`cmd/mails`). The React dashboard is built with Vite
  and embedded with `go:embed`. No Next.js, no Node.js at runtime.
- Database: Postgres (kept, not SQLite). Schema is
  `internal/db/migrations/0001_init.sql`, applied by goose on start.
- "Copy, then cut" now applies only to the React screens, the worker, the SDK
  and the extension. Every server behaviour is re-implemented in Go, using
  `/home/shahriyar/dev/next/mail` (read-only) as the reference.
- better-auth is gone: GitHub OAuth (`golang.org/x/oauth2` + `go-github`) and
  `alexedwards/scs` sessions. Owner matched by GitHub numeric id.
- Drizzle, `scripts/test.mjs` and the TS server tests are gone; tests are Go
  tests against scratch Postgres databases (`internal/db/dbtest`).
- No separate docs site. The markdown in `web/src/docs/` is rendered inside
  the dashboard at `/docs`.
- `/api/v1` keeps the same URLs and JSON shapes, so the SDK, extension and
  docs stay valid. The dashboard uses `/api/app/*` (owner session).
- Use maintained libraries rather than hand-rolled code (owner's rule). The
  chosen ones are listed in `CLAUDE.md`.
- Paths below that name `src/...` Next.js files describe the reference app,
  not files in this repo.

## Goal

Mails is a smaller Mailroom for one person. One superuser, full control, GitHub login
only. The product is email: send, receive, mailboxes and folders, plus the API.
Everything built for teams or marketing is removed.

Success means:

- The owner signs in with GitHub, adds a domain, deploys the worker, creates a
  mailbox, and sends and receives mail.
- Any other GitHub account is refused, always.
- The API, SDK, webhooks and browser extension work against the smaller app.
- `pnpm typecheck`, `pnpm lint` and `pnpm test` pass.

## Approach

Copy, then cut. Copy `mail` to `mails` (without `.git`, `node_modules`,
`.next`, `.test-build`, `tsconfig.tsbuildinfo`, `.env`), start a fresh git
history, then delete what is out of scope. The send and receive paths are
reused as they are; they already work.

The 47 existing migrations are deleted. One new migration, generated from the
cut-down schema, creates the database from nothing. Mails is a new
install, not an upgrade of an existing Mailroom database.

## Scope

### Kept

- Mail: send, receive, threads, search, drafts, signatures, attachments,
  live updates (`/api/events`).
- Folders: inbox, drafts, sent, archive, spam, trash (existing `folder` enum,
  unchanged). Spam detection in `ingest.ts` unchanged.
- Labels and filters.
- Forwarding.
- Push notifications (web-push).
- Domains and the Cloudflare worker, managed from the app.
- First-run setup wizard, cut down to the inbox path.
- Bounce tracking: SES events, suppressions (blocked list), delivery log,
  sending metrics, the SES overview.
- Remote image trust.
- Appearance: density only. The theme choice is removed (dark only, see
  "UI system").
- API keys with scopes and reach.
- Public API, webhooks, Node SDK, docs site, in-app docs.
- Browser extension (`packages/extension`). Only its branding text changes;
  it talks to `/api/v1` with an API key, and every route it calls is kept.
- Scripts: `bundle-worker`, `reset-owner`, `ses-status`, `ses-setup-events`,
  `push-keys`, `test`, `mark-migrations-applied`. `seed-demo` is cut down to
  mailboxes and mail.

### Removed

- Campaigns: lists, list members, segments, broadcasts, recipients, clicks,
  automations (nodes, runs, sends), custom events, media, the campaigns
  view switcher, public subscribe/unsubscribe/preferences/archive pages,
  `src/app/(campaigns)`, `src/app/api/campaigns`, `src/app/api/media`.
  (`src/app/api/upload` stays: the composer stages attachments through it.)
- People: organization, member, invitation, team, team member, access grants,
  roles, capabilities, invite acceptance (`src/app/invite`).
- Templates, scheduled send (`message.scheduledAt`), test-mode API keys,
  send-rate limit, the features toggle.
- Password login.
- `organization_id` on every table.
- Background runners: `broadcast-runner.ts`, `automation-runner.ts`.
- Scripts: `seed-showcase`, `banner.html`, `social-icons`. (`shots` stays,
  for UI screenshots.)

## Login

- better-auth with the GitHub provider only. `emailAndPassword` disabled. The
  organization plugin removed.
- A `databaseHooks.user.create.before` hook counts users. Zero: allow. One or
  more: throw `APIError("FORBIDDEN", { message: "This instance already has an owner." })`.
- Account linking disabled (`account.accountLinking.enabled = false`), so a
  second GitHub account with the owner's email cannot attach to the owner.
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` become required. `env.ts`
  fails at boot without them.
- The sign-in page shows one "Continue with GitHub" button.
- `pnpm reset-owner` deletes the user, its sessions and accounts, so the next
  GitHub login claims the instance. Mail and settings stay.

## Access check

`src/server/access.ts` and `src/server/permissions.ts` are replaced by one
function:

```ts
export async function requireOwner(): Promise<{ userId: string; name: string; email: string }>
```

It reads the session and redirects to `/sign-in` when there is none. With one
user and creation blocked, any valid session is the owner. Every
`requireAccess` / `requireCapability` / `assertCan` call becomes
`requireOwner`. Mailbox filtering by grant is removed: the owner sees every
mailbox.

The API keeps its own check in `api-auth.ts`: key hash, scopes and reach.
Only the org lookup is removed.

## Data

Tables kept: `user`, `session`, `account`, `verification`, `domain`,
`mailbox`, `thread`, `message`, `attachment`, `contact`, `label`,
`threadLabel`, `filterRule`, `forwardAddress`, `forwardRule`,
`messageEvent`, `suppression`, `sendJob`, `apiKey`, `webhook`,
`webhookDelivery`, `idempotencyRecord`, `integration`, `imageTrust`,
`preference`, `pushSubscription`, `workspace`.

Tables removed: `organization`, `member`, `invitation`, `team`,
`teamMember`, `accessGrant`, `media`, `template`, `mailingList`,
`listMember`, `segment`, `broadcast`, `broadcastRecipient`,
`broadcastClick`, `automation`, `customEvent`, `automationNode`,
`automationSend`, `automationRun`.

Columns removed: `organization_id` everywhere; unique indexes that included
it keep their other columns (for example `label (name)`,
`domain (name)`, `suppression (address)`). `message.scheduledAt`, test-mode
and template columns, and campaign-only columns on `workspace`
(`campaignsEnabled`, `postalAddress`, `sendRatePerHour`) are removed. Unused
enums are removed.

## API

Kept under `/api/v1`: `emails` (send, batch, get, cancel), `threads` (list,
get, reply), `messages` (get, raw), `attachments`, `mailboxes`, `domains`
(and verify), `labels`, `contacts`, `suppressions`, `webhooks` (and ping),
`webhook-deliveries` (and replay), `stats`, `me`.

Removed: `templates`, `lists`, `events`. Send requests that name a template
or a schedule time are rejected with a 400 by the request schema.

Scopes for removed routes are removed from `api-scopes.ts`. Webhook event
types for removed features are removed from `webhook-events.ts`.

The SDK drops `resources/templates.ts` and the matching types.

## Naming

The product is **Mails**. Every "Mailroom" in code, UI text, docs, the
extension and package metadata becomes "Mails".

- App package: `mails`, version `0.1.0`.
- SDK package: `@shahriyardx/mails`, version `0.1.0`.
- Worker package: `mails-worker`. Docs package: `mails-docs`. Extension
  package: `mails-extension`, display name "Mails".
- Brand images in `docs/public/brand` and `public/` that spell "Mailroom" are
  replaced with a plain text wordmark until real art exists.
- Repository and homepage URLs in `package.json` files are removed until a
  repository exists.

## Settings pages

Kept: account, appearance, notifications, domains, mailboxes, inbound,
forwarding, labels, filters, blocked, api-keys, webhooks, logs, metrics,
reporting, overview.

Removed: people, teams, access, templates, features, media.

## Background jobs

`src/instrumentation.ts` runs migrations, then starts the outbox worker only.
Webhook delivery retries keep working as they do today.

## UI system

The whole interface is rebuilt on a new UI system. The look follows
`/home/shahriyar/dev/bots/slash/slash-commands-dashboard/apps/web`
(`src/app/surfaces.css`, `src/components/ui/button.tsx`,
`src/components/ui/card.tsx`): Material-style tonal surfaces, pill buttons,
large rounded cards. That project builds its parts on Radix; Mails builds
them on Base UI.

### Stack

- Behaviour: `@base-ui/react`. Every `@radix-ui/*` package is removed.
- Styling: Tailwind 4, `class-variance-authority`, `tailwind-merge`, `clsx`.
- Motion: `motion` (added).
- Toasts: `sonner` (kept).
- Icons: Material Symbols Rounded, self-hosted woff2 in `public/fonts`,
  rendered through a `materialIcon(name)` helper like the dashboard's
  `material-icon.tsx`. `lucide-react` is removed.
- Fonts: Google Sans Flex through `next/font/google` for text; Geist Mono
  only for values read as data (addresses, DNS records, ids).

### Where the parts live

The parts are rebuilt in place in `src/components/kit/`, keeping the current
file names and exports (`avatar`, `badge`, `button`, `card`, `checkbox`,
`color-input`, `color-picker`, `confirm`, `dialog`, `dropdown-menu`, `empty`,
`field`, `input`, `list`, `logo`, `popover`, `progress-bar`, `scroll-area`,
`select`, `separator`, `sheet`, `stat`, `switch`, `tabs`, `toast`,
`tooltip`). Screens in `src/components/mail/` change only where the new look
needs it. Parts used only by removed features are deleted.

### Color: soothing dark

Dark only. No light mode, no theme switch, no `prefers-color-scheme` branch.
The goal is low eye strain: no pure black, no pure white, no saturated
color, gentle steps between surfaces.

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `oklch(0.20 0.005 85)` | Page. Soft charcoal. |
| `--foreground` | `oklch(0.88 0.01 85)` | Body text. Warm off-white, about 12:1 on the page. |
| `--muted-foreground` | `oklch(0.66 0.008 85)` | Secondary text, about 5.8:1. |
| `--primary` | `oklch(0.80 0.01 85)` | Main button fill. Soft light grey. |
| `--primary-foreground` | `--background` | Main button label. |
| `--destructive` | `oklch(0.68 0.10 25)` | Delete actions and errors only. |

- Every grey sits at hue 85 with chroma at or below 0.01: warm, read as
  grey, never as a color.
- Surfaces are mixed from `--foreground` into `--background` in srgb, like
  the dashboard's `.dark` block: `--surface-1` (cards), `--surface-box`
  (a box in a card), `--field-card` and `--field-box` (fields), each a small
  step lighter than what it sits on. `--border` and `--input` are the same
  kind of mix.
- Tonal buttons: `--tonal` is a foreground mix over the background, with
  off-white text.
- Unread, selected and focus use weight, a lighter fill and an off-white
  focus ring. No accent color.
- No text/background pair may fall under 4.5:1. Text pairs aim at 10-13:1,
  not higher.

### Shape

- Buttons: full pills (`rounded-full`), heights 32/40/48.
- Cards and dialogs: `rounded-3xl`. Menus and popovers: `rounded-2xl`.
  Fields: `rounded-xl`.
- Press: a pill button morphs toward a rounded square (`rounded-xl`) while
  held, and springs back.

### Motion

- One file, `src/components/kit/motion.ts`, holds the spring presets. It
  follows Material 3 Expressive's split: spatial springs (position, size,
  shape) with a little bounce, and effects springs (opacity, color) with no
  bounce. Bounce is kept low, so things settle softly rather than jiggle.
- The root layout wraps the app in `<MotionConfig reducedMotion="user">`, so
  the system "reduce motion" setting turns every spring into a plain fade.
- Dialogs, menus, popovers and selects spring open from their trigger.
- On phones (below `md`), dialogs render as bottom sheets that can be dragged
  down to close.
- Thread list: on touch screens, swiping a row left archives it and right
  moves it to trash, with the action shown under the row.
- Compose is an extended floating action button. The active item in the
  sidebar has a pill indicator that slides between items (shared layout
  animation).

### Extension

`packages/extension` takes the same color tokens and fonts. It does not add
`motion`.

### Design notes

`DESIGN.md` is rewritten to describe this system and replaces the current
one (indigo accent, Radix, light-first).

## Docs

The docs site (`docs/`) and in-app `/docs` lose: `guide/automations`,
`guide/campaigns`, `guide/templates`, `guide/test-mode`, `api/templates`,
`api/events`, and every mention of roles, teams, invitations and password
login. `guide/self-hosting` and `README.md` are rewritten for the
single-owner, GitHub-only setup. `test/docs.test.ts` keeps the docs and the
API in step.

## Testing

- Deleted with their features: `automation-flow`, `automations`,
  `broadcast-send`, `campaign-access`, `campaign-body`, `campaigns`,
  `custom-events`, `email-blocks`, `email-theme`, `scheduling`, `send-rate`,
  `templates`, `test-mode`.
- Trimmed: `workspace` keeps only the setup-wizard cases ("is sent to the
  wizard", "creates the row on the first write", "keeps the wizard away once
  it has been finished"); the inbox/campaigns toggle cases are deleted.
- Kept and fixed for the missing org column: `appearance`, `forwarding`,
  `image-trust`, `inbound-headers`, `labels`, `last-view`, `metrics`,
  `outbox`, `push-readers`, `thread-paging`, `threading`, `trash`,
  `version`, `webhook-scope`, `docs`.
- New: a second user creation is refused once an owner exists; account
  linking is off.
- New: `test/contrast.test.ts` reads the color tokens from `globals.css`,
  computes WCAG contrast for every text/background pair in the table above
  and the surface steps, and fails below 4.5:1.
- `appearance` test: the theme cases are deleted; density cases stay.
- Visual check: `scripts/shots.mjs` screenshots the inbox, a conversation,
  the composer, settings and a phone-width inbox for review.
- Manual end-to-end check on the real setup: send one mail out through SES,
  receive one mail through the worker, see both in the app.

## Out of scope

Migrating data from an existing Mailroom database. Multi-user of any kind.
Password login. Campaigns.
