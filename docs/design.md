# Mails design

How the dashboard looks and moves, and the rules that keep it that way. The
code is the source of truth: tokens in `web/src/styles/tokens.css`, fonts and
the token-to-Tailwind mapping in `web/src/styles/app.css`, springs in
`web/src/components/kit/motion.ts`, parts in `web/src/components/kit/`.

The look replaced an earlier Material-style one (pill buttons, tonal rounded
cards, Google Sans) in November 2026. It follows the owner's chosen mockup:
an ink background, flat panels split by hairlines, one lavender accent.

## Principles

- **Calm and flat.** Panels are flat fills separated by 1px hairlines, not
  stacked tonal blobs. One accent colour (lavender), used for the main
  action, the selection and unread times. Mail is read for hours.
- **One kit.** Every screen is built from `web/src/components/kit` and the
  shared pieces next to it (`components/app`, `routes/settings/parts.tsx`).
  A new look is a kit change, never a one-off style in a page.
- **Behaviour from Base UI.** Focus, keyboard and ARIA come from
  `@base-ui/react`; the kit only styles it. No other UI library.
- **Readable first.** Every text/background pair is at least 4.5:1 in both
  themes, enforced by `web/src/test/contrast.test.ts`.

## Themes

Dark is the default; light is the same design on paper. `<html data-theme>`
always holds the resolved theme (`dark` or `light`), so CSS never branches on
`prefers-color-scheme`.

- **Choice:** System, Dark or Light, on Settings -> Preferences. The icon
  button beside the brand (sidebar header, mail, settings and docs) flips
  between dark and light.
- **Saved:** `PATCH /api/app/preferences {"theme": "dark"|"light"|"system"}`
  and `localStorage["mails-theme"]`. If the server does not keep `theme`
  (older server), localStorage still does. When the server's value loads it
  wins (another device may have changed it).
- **No flash:** an inline script in `web/index.html` reads localStorage and
  sets `data-theme` and `<meta name="theme-color">` before first paint.
  `src/lib/theme.ts` (`useTheme`, `applyTheme`, `watchSystemTheme`) does the
  rest; "system" follows the OS live.
- **Mail bodies** render in a sandboxed frame with their own stylesheet;
  `frameStyles(onWhite, theme)` gives it the theme's text and quote colours.
  Mail that paints its own background keeps a white sheet in both themes.

## Colour tokens

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--background` | `#16151a` | `#f6f5f9` | The page, list and reading pane |
| `--surface-1` (`bg-surface`) | `#1d1c22` | `#ffffff` | Panels: cards, the open row, "your reply" |
| `--surface-2` (`bg-surface-high`) | `#232229` | `#ffffff` | Raised: dialogs, menus, popovers, composer |
| `--surface-box` (`bg-box`) | `#1a191f` | `#f8f7fb` | Row hover inside a panel |
| `--field-card` / `--field-box` | `#18171c` / `#1d1c22` | `#ffffff` | Field fill (on a panel / inside a box) |
| `--border` | `#2a2930` | `#e6e4ee` | Hairlines |
| `--input` | `#3a3942` | `#d4d1de` | Field outlines, switch track |
| `--foreground` | `#ecebf0` | `#1b1a22` | Titles, names, subjects |
| `--soft-foreground` | `#b9b7c3` | `#4b4957` | Body text, nav rows, secondary buttons |
| `--muted-foreground` | `#94929f` | `#686574` | Snippets, times, help text, group titles |
| `--primary` | `#a99cf5` | `#6b5bd6` | Main button fill, selection bar, focus ring |
| `--primary-foreground` | `#16151a` | `#ffffff` | Text on the main button |
| `--accent` | `#a99cf5` | `#5b4bc8` | Accent text: unread times, "YOUR REPLY", links, label chips |
| `--accent-soft` | `#2a2640` | `#ece9fb` | Label chips, the shown-once secret box |
| `--tonal` / `--tonal-hover` | `#25242b` / `#2c2b33` | `#efedf5` / `#e7e5ef` | Chips, quick actions, secondary buttons |
| `--selected` | `#24232a` | `#f1effa` | Picked rows (bulk selection) |
| `--destructive` / `--destructive-soft` | `#f0938b` / `#3a2226` | `#b8362f` / `#fbe9e7` | Delete and errors only |
| `--inverse` / `--inverse-foreground` | `#ecebf0` / `#16151a` | `#1b1a22` / `#f6f5f9` | Tooltips and toasts |

The mockup's muted grey (`#7c7a87` dark, `#7e7b8a` light) and light accent
text (`#6b5bd6` on its soft chip) fell under 4.5:1, so muted is a step
lighter in dark and darker in light, and light accent text is a step deeper
than the light button fill. Status dots use green `#5fbf8a`, amber `#d9a54a`
and `--destructive`.

**Avatars** show initials on a tint whose hue comes from the address
(`hueFor` in `kit/avatar.tsx`) and whose lightness/chroma come from the theme
(`--avatar-*` tokens); the test checks every hue. A real picture from
`GET /api/app/avatar?address=` (brand logo, Gravatar or site icon; 404 when
there is none) is laid over once it has loaded (`loading="lazy"`), and
dropped on error, so a missing picture never flashes as a broken image.

## Type and icons

- **Sora** for headings and the brand (h1-h3 get it from the base layer;
  `font-display` elsewhere): folder title 26px bold, conversation subject
  32px semibold, settings page title 30px bold, day labels 12px semibold.
- **Inter** for text, 14px base (`cv11`, `ss01`). Names semibold, unread
  bold.
- **JetBrains Mono** (`font-mono`) for data: times, addresses, counts, DNS
  records, ids, keys.
- All three self-hosted from `@fontsource-variable`, Latin and Latin
  Extended only.
- **Material Symbols Rounded** at weight 300 (to sit with Inter), self-hosted
  as a subset. Add one in `web/scripts/fetch-icons.mjs`, then `pnpm icons`
  and bump `?v=`. Render through the kit's `Icon` / `IconButton`; every
  icon-only button has a label.

## Shape and layout

| Part | Shape |
| --- | --- |
| Buttons | 28 / 32 / 38 / 44px high, 7-10px corners, never pills. Variants `primary` (lavender), `tonal` (chip grey), `outline` (hairline), `ghost`, `destructive` |
| Filter chips, avatars | Fully round (the only round things) |
| Cards, panels, lists | 14px corners, 1px `--border`, flat `bg-surface` |
| Dialogs | 16px corners, hairline, soft shadow; bottom sheets below `md` |
| Menus, popovers, selects | 12px corners; items 8px high rows with 6px corners |
| Fields | 8px corners, `--input` outline; focus turns it lavender with a 3px soft ring |
| Label and mailbox marks | 8px squares, 2px corners, in the label/mailbox colour |

**Mail screen** (desktop): sidebar 232px | list 452px (400px below `xl`) |
reading pane, split by hairlines, no top bar.

- Sidebar: brand (lavender diamond + "Mails") with the theme switch, "Write
  message" (lavender, 40px), folder rows (active row is a panel with a
  hairline; counts only on Inbox, Drafts and Spam), MAILBOXES (only with two
  or more mailboxes) and LABELS groups with coloured squares, Settings and
  the account avatar at the bottom.
- List: big folder title with search and view options, filter chips (All,
  Unread, one per mailbox; none in Sent and Drafts), then threads grouped by
  day (Today, Yesterday, Earlier this week, then dates) with "Mark all read"
  on the first group. Rows: 46px round avatar, sender (bold when unread),
  mono time (lavender when unread), subject, one-line snippet; the mailbox
  square only with two or more mailboxes. The open thread is a raised panel
  with a lavender bar on the left (its actions live in the reading pane).
  Picking threads (hover the avatar) brings up a floating bulk bar.
- Reading pane: a 660px column. Label chips and the thread's actions
  (Archive, Label, Star, more), the Sora subject, then each message: received
  mail as a letter (avatar, name, mono address and time, body); the owner's
  own messages in a "YOUR REPLY · time" panel. Reply (primary), Reply all,
  Forward at the end, each with its icon.
- Phones: list and conversation take turns, the sidebar is a drawer, dialogs
  are bottom sheets, a "Write" button floats over the list.

**Settings and docs** use the same sidebar frame (brand + theme switch) with
their own grouped nav and a "Back to mail" row. Pages sit in a centred 760px
column: big title, one muted line, the primary action on the title row
(`<PageAction>`), lists as roomy rows in one panel with status dots, sections
split by headings rather than boxes in boxes, a red-edged "Danger zone" card
last, and shown-once secrets in a lavender mono box with a copy button.

**Less on screen.** Each fact is said once:

- A status dot marks only what needs attention (Pending, Failing, Revoked,
  Waiting). Healthy rows (verified, active, deployed) carry no badge, and a
  switch, button label or "Never" already saying the state gets no dot.
- An empty list is one short sentence in a dashed box; the add button stays
  on the title row, never a second copy inside.
- No helper text that repeats a title, label or placeholder, and no
  explanation of internals (SES, SNS, the worker). Keep only what prevents
  a mistake: data loss, security, irreversible steps, easy-to-miss settings.
- One control per action on a screen: a filter chip is not also a menu item,
  a page in the sidebar is not also a link row on the page.

## Motion

Calm: things fade and move a few pixels; nothing bounces or morphs.

| Preset | Spring | For |
| --- | --- | --- |
| `spatial` | 0.35 s, bounce 0.15 | Position and size (sheets, swipe, bulk bar) |
| `spatialFast` | 0.22 s, bounce 0.10 | Small moves (switch thumb, tab indicator) |
| `effects` | 0.20 s, no bounce | Opacity, colour |

Motion components use the presets directly; CSS transitions (Base UI popups)
read the same springs from `--spring-*` variables. Popups fade in from 97%
scale and 2px up. Buttons only change colour on hover and press. The app is
wrapped in `<MotionConfig reducedMotion="user">`, and the CSS spatial springs
drop to zero under `prefers-reduced-motion`.

- On touch, swiping a thread left archives it and right trashes it.
- Focus rings are always visible: 2px `--ring` (lavender) outline.

## Mail content

Received mail is untrusted and never shares the app's page:

- It renders in a sandboxed iframe (no scripts) with its own CSP.
- `web/src/lib/sanitize.ts` removes active content, every remote fetch
  (until the reader allows images), forms and inputs, and out-of-flow layout
  (position, transforms, negative margins) so a message cannot draw over its
  own text or imitate the app. CSS is judged after the browser parses it, and
  a style block containing `<` is dropped.
- The frame loads no web fonts (`font-src data:`), so bodies use Inter only
  where it is installed, else the system sans.
- The composer is part of the app's page, so quoted or pasted mail loses all
  styling there (`sanitizeForEditor`).

The browser extension (`packages/extension`) has its own copy of the
sanitizing rules and has not been moved to the new look yet.

## Adding a screen

See `web/README.md`: one file per settings page plus one entry (with a
one-line `description`) in `web/src/routes/settings/pages.ts`, data through
the typed hooks in `web/src/lib/api.ts`. Check it with `pnpm shots`
(`web/scripts/shots.mjs`, `THEME=light` for the light theme) at desktop and
phone width.
