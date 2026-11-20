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
  styles/tokens.css      colour tokens (soothing dark, the only theme)
  styles/app.css         Tailwind, fonts, theme mapping
  test/contrast.test.ts  fails if any text/surface pair in tokens.css is under 4.5:1
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
   import { Card, CardContent, CardHeader, CardTitle, List, ListRow, Button } from "@/components/kit";
   import { useMailboxes } from "@/lib/api";

   export default function Mailboxes() {
     const mailboxes = useMailboxes();
     return (
       <Card>
         <CardHeader><CardTitle>Mailboxes</CardTitle></CardHeader>
         <CardContent>
           <List>
             {mailboxes.data?.map((m) => <ListRow key={m.id} icon="alternate_email" title={m.address} />)}
           </List>
         </CardContent>
       </Card>
     );
   }
   ```

2. In `src/routes/settings/pages.ts`, add `load` to the page's entry (or a new
   entry; `icon` must be in the icon subset):

   ```ts
   { path: "mailboxes", title: "Mailboxes", icon: "alternate_email", group: "Mail",
     load: () => import("./mailboxes") },
   ```

That is all: the router, the settings nav and the page title read that list.
The page renders inside the settings shell (header with the title, a centred
`max-w-3xl` column). Nothing else needs to change.

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
- Actions: `Button` (variants `primary | tonal | ghost | destructive`, sizes
  `sm | md | lg`, `icon`, `loading`; `render={<Link to=... />} nativeButton={false}`
  for links), `IconButton` (`icon` + required `label`), `Tooltip`.
- Overlays: `Dialog` (+ `DialogContent`, `DialogHeader`, `DialogTitle`,
  `DialogDescription`, `DialogFooter`, `DialogClose`; a bottom sheet on phones),
  `ConfirmDialog` for anything destructive, `DropdownMenu` (+ `...Trigger`,
  `...Content`, `...Item`, `...LinkItem`, `...CheckboxItem`, `...Label`,
  `...Separator`), `Popover`, `Sheet`, `Tabs` (+ `TabsList`, `TabsTab`,
  `TabsPanel`), `ProgressBar`, `toast`.
- Text: Google Sans Flex by default; add `font-mono` (Geist Mono) for values
  read as data: addresses, DNS records, ids, keys.

Triggers take the element to render as `render`, Base UI style:
`<DropdownMenuTrigger render={<IconButton icon="more_vert" label="More" />} />`.

## Design rules

- Colours only from tokens (`bg-surface`, `bg-box`, `bg-field`, `bg-tonal`,
  `bg-selected`, `text-muted-foreground`, `text-destructive`...). No accent
  colour; no light mode. Change `tokens.css` only with `pnpm test` green.
- Shape: pills for buttons, `rounded-3xl` cards and dialogs, `rounded-2xl`
  menus, `rounded-xl` fields.
- Motion: springs from `components/kit/motion.ts` (`spatial`, `spatialFast`,
  `effects`) for motion components; CSS uses `var(--spring-spatial)` and
  `var(--spring-effects)`. Reduced motion is handled globally.
- Every icon-only control has a label (`IconButton` requires one).

## Icons

Material Symbols Rounded, self-hosted as a subset (~30 KB). To add an icon, add
its name to `ICONS` in `scripts/fetch-icons.mjs`, run `pnpm icons`, commit the
new `public/fonts/material-symbols-rounded.woff2`, and bump `?v=` in
`src/styles/app.css` and `index.html`. Render with `<Icon name="inbox" />`.
