# Mails design

How the dashboard looks and moves, and the rules that keep it that way. The
code is the source of truth: tokens in `web/src/styles/tokens.css`, springs
in `web/src/components/kit/motion.ts`, parts in `web/src/components/kit/`.

## Principles

- **Calm.** Dark only, low contrast steps, no saturated colour. Mail is read
  for hours; nothing should shout.
- **One kit.** Every screen is built from `web/src/components/kit`. A new
  look is a kit change, never a one-off style in a page.
- **Behaviour from Base UI.** Focus, keyboard and ARIA come from
  `@base-ui/react`; the kit only styles it. No other UI library.
- **Readable first.** Every text/background pair is at least 4.5:1, enforced
  by `web/src/test/contrast.test.ts`.

## Colour: soothing dark

No light mode, no theme switch, no `prefers-color-scheme` branch.

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `oklch(0.20 0.005 85)` | The page. Soft charcoal, never black |
| `--foreground` | `oklch(0.88 0.01 85)` | Body text. Warm off-white, never white |
| `--muted-foreground` | `oklch(0.66 0.008 85)` | Secondary text |
| `--primary` | `oklch(0.80 0.01 85)` | The main button's fill |
| `--primary-foreground` | `--background` | The main button's label |
| `--destructive` | `oklch(0.68 0.10 25)` | Delete and errors only |

Every grey sits at hue 85 with chroma at or below 0.01: warm, but read as
grey. Surfaces are `--foreground` mixed into `--background` in srgb, each a
small step lighter than what it sits on:

| Token | Mix | Use |
| --- | --- | --- |
| `--surface-1` | 4% | Cards |
| `--surface-2`, `--surface-box` | 7% | A box inside a card |
| `--field-card`, `--tonal` | 9% | Fields on a card; tonal buttons |
| `--selected` | 10% | The selected row |
| `--field-box`, `--tonal-hover` | 11% | Fields in a box; hover |
| `--border` | 12% | Lines |
| `--input` | 16% | Field outlines |
| `--ring` | 75% | The focus ring |

`--muted-foreground` falls under 4.5:1 above an 11% mix, so **no surface
that carries text goes beyond 11%**. The contrast test fails the build if
one does.

Unread, selected and focused are shown with weight, a lighter fill and the
off-white ring. There is no accent colour.

## Type and icons

- **Google Sans Flex** for text, **Geist Mono** for values read as data:
  addresses, DNS records, ids, timestamps in lists. Both self-hosted.
- **Material Symbols Rounded**, self-hosted as a subset of the icons the app
  uses. Add one in `web/scripts/fetch-icons.mjs`, then `pnpm icons`. Render
  through the kit's `Icon` / `IconButton`; every icon-only button has a label.

## Shape

| Part | Radius |
| --- | --- |
| Buttons | Full pill (`rounded-full`), heights 32 / 40 / 48 |
| Cards, dialogs | `rounded-3xl` |
| Menus, popovers | `rounded-2xl` |
| Fields | `rounded-xl` |

A pressed pill morphs toward `rounded-xl` and springs back.

## Motion

Material 3 Expressive's split, with low bounce so things settle softly:

| Preset | Spring | For |
| --- | --- | --- |
| `spatial` | 0.35 s, bounce 0.15 | Position, size, shape |
| `spatialFast` | 0.22 s, bounce 0.10 | Small moves (the sidebar pill) |
| `effects` | 0.20 s, no bounce | Opacity, colour |

Motion components use the presets directly; CSS transitions (Base UI popups,
button press) read the same springs from `--spring-*` variables. The app is
wrapped in `<MotionConfig reducedMotion="user">`, and the CSS spatial
springs drop to zero under `prefers-reduced-motion`: everything becomes a
plain fade.

- Dialogs, menus, popovers and selects spring open from their trigger.
- Below `md`, dialogs are bottom sheets that drag down to close.
- On touch, swiping a thread left archives it and right trashes it.
- Compose is an extended floating button; the sidebar's active item has a
  pill that slides between items (shared layout).

## Mail content

Received mail is untrusted and never shares the app's page:

- It renders in a sandboxed iframe (no scripts) with its own CSP.
- `web/src/lib/sanitize.ts` removes active content, every remote fetch
  (until the reader allows images), forms and inputs, and out-of-flow layout
  (position, transforms, negative margins) so a message cannot draw over its
  own text or imitate the app. CSS is judged after the browser parses it, and
  a style block containing `<` is dropped.
- The composer is part of the app's page, so quoted or pasted mail loses all
  styling there (`sanitizeForEditor`).

The browser extension (`packages/extension`) uses the same colour tokens,
fonts and sanitizing rules, without `motion`.

## Adding a screen

See `web/README.md`: one file per settings page plus one line in
`web/src/routes/settings/pages.ts`, data through the typed hooks in
`web/src/lib/api.ts`. Check it with `pnpm shots` (`web/scripts/shots.mjs`)
at desktop and phone width.
