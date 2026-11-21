import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Sheet,
  SheetContent,
  SheetTitle,
  Tooltip,
  toast,
} from "@/components/kit";
import { spatial } from "@/components/kit/motion";
import { useComposer } from "@/components/mail/composer-provider";
import { Sidebar, SidebarAside } from "@/components/mail/sidebar";
import { ThreadList } from "@/components/mail/thread-list";
import { ThreadView } from "@/components/mail/thread-view";
import {
  useCounts,
  useEmptyTrash,
  useLabels,
  useMailboxes,
  usePreferences,
  useSavePreferences,
  useThreads,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { shortcutBlocked } from "@/lib/hooks";
import { FOLDER_META, isFolder, mailHref, parseScope, type Scope, withListParam } from "@/lib/mail";
import { useDocumentTitle } from "@/lib/title";
import type { ThreadFilter, ViewFolder } from "@/lib/types";

/** /mail/:scope/:folder?t=&reply=&q=&label=&unread= */
export function Component() {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const composer = useComposer();
  const prefs = usePreferences();
  const mailboxes = useMailboxes();
  const [navOpen, setNavOpen] = useState(false);

  const folder = params.folder;
  const scope = parseScope(params.scope);
  const threadId = search.get("t") ?? undefined;
  const label = search.get("label");
  const q = search.get("q") ?? "";
  const unread = search.get("unread") === "1" || search.get("unread") === "true";
  const [searching, setSearching] = useState(Boolean(q));
  // A search started elsewhere (the command menu) shows the search box too.
  useEffect(() => {
    if (q) setSearching(true);
  }, [q]);

  // c: compose, /: search (outside text fields).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (shortcutBlocked(event)) return;
      // One composer at a time: "c" never replaces the one being written.
      if (event.key === "c" && !composer.isOpen) {
        event.preventDefault();
        composer.open();
      } else if (event.key === "/") {
        event.preventDefault();
        setSearching(true);
        document.getElementById("mail-search")?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composer]);

  if (!isFolder(folder)) return <Navigate to={mailHref(params.scope ?? "all", "inbox")} replace />;

  const filter: ThreadFilter = {
    // A label view shows the label across folders.
    folder: label ? undefined : folder,
    mailbox: scope.kind === "mailbox" ? scope.id : undefined,
    domain: scope.kind === "domain" ? scope.domain : undefined,
    label: label ?? undefined,
    q: q || undefined,
    unread: unread || undefined,
  };

  const listQuery = new URLSearchParams(search);
  listQuery.delete("t");
  listQuery.delete("reply");
  const backHref = `${mailHref(scope, folder)}${listQuery.size ? `?${listQuery}` : ""}`;
  const hrefFor = (id: string, reply?: string) => {
    const next = new URLSearchParams(listQuery);
    next.set("t", id);
    if (reply) next.set("reply", reply);
    return `${mailHref(scope, folder)}?${next}`;
  };

  function setParam(key: string, value: string | null) {
    setSearch((current) => withListParam(current, key, value));
  }

  const stacked = prefs.data?.reading_layout === "stacked";
  const compact = prefs.data?.density === "compact";
  const sidebarProps = { scope, folder, label };

  const header = (
    <ListHeader
      scope={scope}
      folder={folder}
      label={label}
      q={q}
      unread={unread}
      searching={searching}
      onSearching={setSearching}
      onSearch={(value) => setParam("q", value || null)}
      onUnread={(on) => setParam("unread", on ? "1" : null)}
      onMenu={() => setNavOpen(true)}
      filter={filter}
      listQuery={listQuery}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <SidebarAside>
        <Sidebar {...sidebarProps} />
      </SidebarAside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar {...sidebarProps} onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>

      <section
        aria-label="Conversations"
        className={cn(
          "min-w-0 flex-col overflow-hidden",
          stacked
            ? threadId
              ? "hidden"
              : "flex flex-1"
            : cn(
                // A fixed column on wide screens; it fills the width only
                // below lg, where the list and a conversation take turns.
                "lg:flex lg:w-[25rem] lg:flex-none lg:border-r lg:border-border xl:w-[28.25rem]",
                threadId ? "hidden" : "flex flex-1",
              ),
        )}
      >
        <ThreadList
          header={header}
          filter={filter}
          folder={folder}
          activeId={threadId}
          hrefFor={hrefFor}
          compact={compact}
          showMailbox={scope.kind !== "mailbox" && (mailboxes.data?.length ?? 0) > 1}
          openOnMove={!stacked}
        />
      </section>

      <main
        aria-label="Conversation"
        className={cn(
          "min-w-0 flex-1 flex-col overflow-hidden",
          stacked ? (threadId ? "flex" : "hidden") : threadId ? "flex" : "hidden lg:flex",
        )}
      >
        {threadId ? (
          <ThreadView
            threadId={threadId}
            backHref={backHref}
            folder={folder}
            filter={filter}
            hrefFor={hrefFor}
          />
        ) : (
          <div className="grid flex-1 place-items-center px-6 text-center">
            <p className="text-[13px] text-muted-foreground">No conversation open</p>
          </div>
        )}
      </main>

      {/* Phones: compose floats over the list. */}
      {!threadId && !composer.isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spatial}
          className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 md:hidden"
        >
          <Button
            variant="primary"
            size="lg"
            icon="edit"
            className="h-12 rounded-xl px-5 font-semibold shadow-[0_8px_24px_var(--shadow)]"
            onClick={() => composer.open()}
          >
            Write
          </Button>
        </motion.div>
      )}
    </div>
  );
}

/** The folder title with its tools, an optional search row, and filter chips. */
function ListHeader({
  scope,
  folder,
  label,
  q,
  unread,
  searching,
  onSearching,
  onSearch,
  onUnread,
  onMenu,
  filter,
  listQuery,
}: {
  scope: Scope;
  folder: ViewFolder;
  label: string | null;
  q: string;
  unread: boolean;
  searching: boolean;
  onSearching: (on: boolean) => void;
  onSearch: (value: string) => void;
  onUnread: (on: boolean) => void;
  onMenu: () => void;
  filter: ThreadFilter;
  listQuery: URLSearchParams;
}) {
  const labels = useLabels();
  const title = q
    ? "Search"
    : label
      ? (labels.data?.find((l) => l.id === label)?.name ?? "Label")
      : FOLDER_META[folder].label;
  // The sidebar's counts query (same scope, so the same cache).
  const counts = useCounts({ mailbox: filter.mailbox, domain: filter.domain });
  useDocumentTitle(title, counts.data?.folders.inbox);
  // Nothing in Sent or Drafts is unread, so there is nothing to filter by.
  const canUnread = Boolean(label) || (folder !== "sent" && folder !== "drafts");

  const chipHref = (target: Scope | string, keepUnread: boolean) => {
    const next = new URLSearchParams(listQuery);
    if (!keepUnread) next.delete("unread");
    const qs = next.toString();
    return `${mailHref(target, folder)}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="shrink-0 px-4 pt-4 md:px-5.5 md:pt-5.5">
      <div className="flex items-center gap-1">
        <IconButton
          icon="menu"
          label="Open navigation"
          className="-ml-2 md:hidden"
          onClick={onMenu}
        />
        <h1 className="min-w-0 flex-1 truncate text-[26px] leading-tight font-bold">{title}</h1>
        {folder === "trash" && !label && !q && <EmptyTrash scope={filter} />}
        <Tooltip label="Search (/)">
          <IconButton
            icon="search"
            label="Search mail"
            aria-expanded={searching}
            variant={searching ? "tonal" : "ghost"}
            onClick={() => {
              if (searching && q) onSearch("");
              onSearching(!searching);
            }}
          />
        </Tooltip>
        <ViewMenu />
      </div>

      {searching && (
        <SearchBox key={q} value={q} onCommit={onSearch} onClose={() => onSearching(false)} />
      )}

      {/* Which mailbox is picked in the sidebar; here only All or Unread. */}
      {canUnread && (
        <div className="mt-3 flex gap-1.5">
          <Chip to={chipHref(scope, false)} active={!unread}>
            All
          </Chip>
          <Chip
            to={chipHref(scope, true)}
            active={unread}
            onClick={(event) => {
              event.preventDefault();
              onUnread(!unread);
            }}
          >
            Unread
          </Chip>
        </div>
      )}
    </div>
  );
}

function Chip({
  to,
  active,
  title,
  onClick,
  children,
}: {
  to: string;
  active: boolean;
  title?: string;
  onClick?: (event: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      title={title}
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "shrink-0 rounded-full px-2.75 py-1.25 text-[12.5px] font-semibold whitespace-nowrap outline-none transition-colors focus-visible:outline-2 focus-visible:outline-ring",
        active
          ? "bg-foreground text-background"
          : "bg-tonal text-soft-foreground hover:bg-tonal-hover hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function SearchBox({
  value,
  onCommit,
  onClose,
}: {
  value: string;
  onCommit: (value: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  return (
    <form
      className="mt-3 flex h-9.5 items-center gap-2 rounded-lg border border-input bg-field pr-1 pl-3 focus-within:border-ring focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_25%,transparent)]"
      onSubmit={(event) => {
        event.preventDefault();
        onCommit(text.trim());
        input.current?.blur();
      }}
    >
      <label htmlFor="mail-search" className="sr-only">
        Search mail
      </label>
      <input
        ref={input}
        id="mail-search"
        type="search"
        value={text}
        // biome-ignore lint/a11y/noAutofocus: opened on purpose by the search button or "/"
        autoFocus
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setText("");
            // Nothing searched, nothing to clear: leave the URL alone.
            if (text || value) onCommit("");
            onClose();
          }
        }}
        placeholder="Search mail"
        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <IconButton
          icon="close"
          label="Clear search"
          size="xs"
          onClick={() => {
            setText("");
            onCommit("");
          }}
        />
      )}
    </form>
  );
}

function ViewMenu() {
  const prefs = usePreferences();
  const save = useSavePreferences();
  const density = prefs.data?.density ?? "comfortable";
  const layout = prefs.data?.reading_layout ?? "split";
  return (
    <DropdownMenu>
      <Tooltip label="View">
        <DropdownMenuTrigger render={<IconButton icon="tune" label="View options" />} />
      </Tooltip>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Density</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={density === "comfortable"}
          onCheckedChange={() => save.mutate({ density: "comfortable" })}
        >
          Comfortable
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={density === "compact"}
          onCheckedChange={() => save.mutate({ density: "compact" })}
        >
          Compact
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Reading</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={layout === "split"}
          onCheckedChange={() => save.mutate({ reading_layout: "split" })}
        >
          Side by side
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={layout === "stacked"}
          onCheckedChange={() => save.mutate({ reading_layout: "stacked" })}
        >
          One at a time
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmptyTrash({ scope }: { scope: ThreadFilter }) {
  const [open, setOpen] = useState(false);
  const empty = useEmptyTrash();
  // The same query as the list below, so this reads the cache.
  const threads = useThreads(scope);
  if (!threads.data?.pages[0]?.data.length) return null;
  return (
    <>
      <Button variant="destructive" size="sm" icon="delete_forever" onClick={() => setOpen(true)}>
        Empty
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Empty the trash?"
        consequences="Every conversation in Trash here is deleted for good, with its attachments."
        confirmLabel="Empty trash"
        onConfirm={async () => {
          const res = await empty.mutateAsync({ mailbox: scope.mailbox, domain: scope.domain });
          toast(`${res.threads} ${res.threads === 1 ? "conversation" : "conversations"} deleted`);
        }}
      />
    </>
  );
}
