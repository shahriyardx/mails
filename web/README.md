# web: the Mails dashboard

React 19 + Vite + TypeScript (strict) + Tailwind 4, built on Base UI. `pnpm build`
writes `web/dist`, which `web/embed.go` embeds into the Go binary. The Go server
serves it with an `index.html` fallback for client routes, and `assets/` with an
immutable cache.

```sh
cd web
pnpm install
pnpm dev         # http://localhost:5173, /api proxied to the Go server on :3000
pnpm typecheck   # tsc --noEmit
pnpm lint        # biome (config: ../biome.json)
pnpm test        # vitest: sanitize, API client, colour contrast
pnpm build       # -> dist/ (dist/.keep comes back from public/.keep)
pnpm icons       # refetch the Material Symbols subset (see "Icons")
```

## Layout

```
src/
  main.tsx               providers: react-query, MotionConfig reducedMotion="user", tooltips, toasts
  router.tsx             every route; each screen is a lazy chunk
  app/auth-gate.tsx      GET /api/auth/status gate, useOwner(), live updates, composer
  routes/                one file per screen (export `Component`, react-router lazy style)
    mail.tsx             /mail/:scope/:folder (shell, list, thread)
    sign-in.tsx          /sign-in
    settings/layout.tsx  settings shell (nav from pages.ts)
    settings/pages.ts    the list of settings pages  <- add pages here
    settings/placeholder.tsx
    docs.tsx             /docs/* markdown viewer (web/src/docs + nav.json)
  components/kit/        the UI kit (import from "@/components/kit")
  components/mail/       mail screens: sidebar, thread list/view, composer, email frame
  components/app/        app-wide pieces (account menu)
  lib/api.ts             the only code that calls the server; hooks per resource
  lib/types.ts           JSON shapes of the Go API
  lib/mail.ts            routes, addresses, subjects, quoting, formatting
  lib/sanitize.ts        mail HTML policy (DOMPurify), keep in step with packages/extension
  lib/theme.ts           dark/light/system: useTheme, applyTheme (index.html sets it before paint)
  styles/tokens.css      colour tokens for the dark (default) and light themes
  styles/app.css         Tailwind, fonts (Sora, Inter, JetBrains Mono), theme mapping
  test/contrast.test.ts  fails if any text/surface pair in either theme is under 4.5:1
public/
  fonts/material-symbols-rounded.woff2   icon subset
  sw.js                  service worker for web push ({title, body, url, tag})
```

## URLs

- `/mail/:scope/:folder?t=<threadId>&reply=reply|replyAll|forward`
  - `scope`: `all`, a domain (`example.com`) or a mailbox id (`mbx_...`)
  - `folder`: `inbox|starred|sent|drafts|archive|spam|trash`
  - `t` opens a thread, `reply` opens the composer once (then is removed)
  - also `q` (search), `label` (label id), `unread=1`
  - The browser extension and web push link here: keep the format.
  - `/mail/inbox?thread=...` (older links) redirects to `/mail/all/inbox?t=...`.
- `/settings/<page>`, `/docs/*`, `/sign-in`.

## Adding a settings page (phase 2)

1. Create `src/routes/settings/<name>.tsx` with a default export:

   ```tsx
   import { Button, List, ListRow } from "@/components/kit";
   import { useMailboxes } from "@/lib/api";
   import { PageAction, StatusDot } from "./parts";

   export default function Mailboxes() {
     const mailboxes = useMailboxes();
     return (
       <>
         <PageAction><Button variant="primary" icon="add">Add mailbox</Button></PageAction>
         <List>
           {mailboxes.data?.map((m) => (
             <ListRow key={m.id} title={m.display_name} description={m.address}
               action={<StatusDot tone="ok">Receiving</StatusDot>} />
           ))}
         </List>
       </>
     );
   }
   ```

2. In `src/routes/settings/pages.ts`, add the page's entry (`icon` must be in
   the icon subset; `description` is the line under the title):

   ```ts
   { path: "mailboxes", title: "Mailboxes", group: "Sending", icon: "alternate_email",
     description: "The addresses that send and receive mail.",
     load: () => import("./mailboxes") },
   ```

That is all: the router, the settings nav and the page header read that list.
The page renders inside the settings shell (a centred 760px column under the
big title and its description; `<PageAction>` puts the primary action on the
title row). Nothing else needs to change.

Settings pieces in `src/routes/settings/parts.tsx`: `PageAction`, `Section`
(heading + muted line, no box), `StatusDot` (`ok | pending | bad | off`),
`DangerZone` + `DangerRow` (last on the page), `CopyValue`, `Notice`,
`SwitchRow`, `PageLoading`, `LoadError`. Secrets shown once: `OnceSecret` in
`src/components/app/copy.tsx`.

### Data for a page

Add the endpoint to `src/lib/api.ts` next to its neighbours, never `fetch` in a
component:

```ts
export function useDomains() {
  return useQuery({
    queryKey: ["domains"],
    queryFn: ({ signal }) => api<{ data: Domain[]; warning?: string }>("/api/app/domains", { signal }),
  });
}

export function useCreateDomain() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<Domain>("/api/app/domains", { method: "POST", body: { name } }),
    onSettled: () => client.invalidateQueries({ queryKey: ["domains"] }),
  });
}
```

- `api()` sends objects as JSON and `FormData` as multipart, and throws
  `ApiError {status, code, message}` built from the server's `{error, code}`.
- Show failures with `toast.error(errorMessage(error))`.
- A 401 anywhere re-checks the session and sends the user to sign-in.
- Put response types in `src/lib/types.ts`, named after the Go struct.

Hooks that exist today: `useAuthStatus`, `useSignOut`, `useThreads`, `useThread`,
`useCounts`, `useChangeThreads`, `useDeleteThreads`, `useRestoreThreads`,
`useEmptyTrash`, `useLabels`, `useCreateLabel`, `useMailboxes`, `useContacts`,
`useImageTrust`, `useSetImageTrust`, `usePreferences`, `useSavePreferences`,
`useSetup`, `useSend`, `saveDraft`, `useDeleteDraft`, `uploadFile`,
`useLiveUpdates`. Phase 2 needs new ones for domains, mailbox CRUD, labels
edit/delete, filters, blocked, forwarding, inbound (Cloudflare), API keys,
webhooks, logs, metrics, push subscribe (`POST /api/app/push/subscribe`, with
`navigator.serviceWorker.ready` since main.tsx registers `/sw.js`).

### Kit parts for settings pages

- Layout: `Card` (+ `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`,
  `CardContent`, `CardFooter`), `List` + `ListRow` + `ListEmpty` for rows of
  things, `Stat` / `Stats` for numbers, `EmptyState`, `Skeleton`, `Separator`.
- Forms: `Field` (label, description, error) around `Input` / `Textarea` /
  `Select` (+ `SelectTrigger`, `SelectContent`, `SelectItem`; pass `items` to
  the root so the trigger shows labels), `Switch`, `Checkbox`, `ColorPicker`,
  `ColorInput`.
- Actions: `Button` (variants `primary | tonal | outline | ghost | destructive`,
  sizes `xs | sm | md | lg`, `icon`, `loading`; `render={<Link to=... />} nativeButton={false}`
  for links), `IconButton` (`icon` + required `label`), `Tooltip`.
- People: `Avatar` (`name`, `address`; initials on a tint from the address,
  with `/api/app/avatar` laid over once it loads), `Badge` (`neutral | accent |
  strong | danger`), `Count`.
- Overlays: `Dialog` (+ `DialogContent`, `DialogHeader`, `DialogTitle`,
  `DialogDescription`, `DialogFooter`, `DialogClose`; a bottom sheet on phones),
  `ConfirmDialog` for anything destructive, `DropdownMenu` (+ `...Trigger`,
  `...Content`, `...Item`, `...LinkItem`, `...CheckboxItem`, `...Label`,
  `...Separator`), `Popover`, `Sheet`, `Tabs` (+ `TabsList`, `TabsTab`,
  `TabsPanel`), `ProgressBar`, `toast`.
- Text: Inter by default, Sora for headings (h1-h3 get it; `font-display`
  elsewhere), `font-mono` (JetBrains Mono) for values read as data: times,
  addresses, DNS records, ids, keys, counts.

Triggers take the element to render as `render`, Base UI style:
`<DropdownMenuTrigger render={<IconButton icon="more_vert" label="More" />} />`.

## Design rules

Full rules: `docs/design.md`.

- Colours only from tokens (`bg-background`, `bg-surface`, `bg-surface-high`,
  `bg-tonal`, `bg-accent-soft`, `border-border`, `text-soft-foreground`,
  `text-muted-foreground`, `text-accent`, `text-destructive`...), so both
  themes work. Change `tokens.css` only with `pnpm test` green.
- Shape: flat panels with a 1px `border-border`, 14px corners for cards, 16px
  dialogs, 8-10px buttons and fields. No pill buttons; only filter chips and
  avatars are round.
- Motion: springs from `components/kit/motion.ts` (`spatial`, `spatialFast`,
  `effects`) for motion components; CSS uses `var(--spring-spatial)` and
  `var(--spring-effects)`. No press morphs. Reduced motion is handled globally.
- Every icon-only control has a label (`IconButton` requires one).

## Icons

Material Symbols Rounded (weight 300), self-hosted as a subset (~34 KB). To add an icon, add
its name to `ICONS` in `scripts/fetch-icons.mjs`, run `pnpm icons`, commit the
new `public/fonts/material-symbols-rounded.woff2`, and bump `?v=` in
`src/styles/app.css` and `index.html`. Render with `<Icon name="inbox" />`.
