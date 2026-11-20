import { LayoutGroup, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router";
import { AccountMenu } from "@/components/app/account-menu";
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  IconButton,
  Sheet,
  SheetContent,
  SheetTitle,
  Tooltip,
  toast,
} from "@/components/kit";
import { spatial } from "@/components/kit/motion";
import { useComposer } from "@/components/mail/composer-provider";
import { SetupCard } from "@/components/mail/setup-card";
import { Sidebar } from "@/components/mail/sidebar";
import { ThreadList } from "@/components/mail/thread-list";
import { ThreadView } from "@/components/mail/thread-view";
import { useEmptyTrash, usePreferences, useSavePreferences } from "@/lib/api";
import { cn } from "@/lib/cn";
import { isFolder, mailHref, parseScope } from "@/lib/mail";
import type { ThreadFilter } from "@/lib/types";

/** /mail/:scope/:folder?t=&reply=&q=&label=&unread= */
export function Component() {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const composer = useComposer();
  const prefs = usePreferences();
  const [navOpen, setNavOpen] = useState(false);

  const folder = params.folder;
  const scope = parseScope(params.scope);
  const threadId = search.get("t") ?? undefined;
  const label = search.get("label");
  const q = search.get("q") ?? "";
  const unread = search.get("unread") === "1" || search.get("unread") === "true";

  // c: compose, /: search (outside text fields).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input, textarea, [contenteditable=true]") ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key === "c") {
        event.preventDefault();
        composer.open();
      } else if (event.key === "/") {
        event.preventDefault();
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
  const hrefFor = (id: string) => {
    const next = new URLSearchParams(listQuery);
    next.set("t", id);
    return `${mailHref(scope, folder)}?${next}`;
  };

  function setParam(key: string, value: string | null) {
    setSearch((current) => {
      if (value) current.set(key, value);
      else current.delete(key);
      current.delete("t");
      return current;
    });
  }

  const stacked = prefs.data?.reading_layout === "stacked";
  const compact = prefs.data?.density === "compact";
  const sidebarProps = { scope, folder, label };

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-64 shrink-0 md:block">
        <LayoutGroup id="nav-fixed">
          <Sidebar {...sidebarProps} instance="fixed" />
        </LayoutGroup>
      </aside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <LayoutGroup id="nav-sheet">
            <Sidebar {...sidebarProps} instance="sheet" onNavigate={() => setNavOpen(false)} />
          </LayoutGroup>
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-2 px-3 md:pl-0">
          <IconButton
            icon="menu"
            label="Open navigation"
            className="md:hidden"
            onClick={() => setNavOpen(true)}
          />
          <SearchBox key={q} value={q} onCommit={(value) => setParam("q", value || null)} />
          <span className="hidden flex-1 md:block" />
          {folder === "trash" && <EmptyTrash scope={filter} />}
          <ViewMenu unread={unread} onUnread={(on) => setParam("unread", on ? "1" : null)} />
          <AccountMenu />
        </header>

        <div className="flex min-h-0 flex-1 gap-2 px-2 pb-2 md:pr-2 md:pl-0">
          <section
            aria-label="Conversations"
            className={cn(
              "min-w-0 flex-col overflow-hidden rounded-3xl bg-surface",
              stacked
                ? threadId
                  ? "hidden"
                  : "flex flex-1"
                : cn(
                    "lg:flex lg:w-[26rem] lg:shrink-0 xl:w-[30rem]",
                    threadId ? "hidden" : "flex flex-1",
                  ),
            )}
          >
            {folder === "inbox" && !label && !q && (
              <div className="pt-2">
                <SetupCard />
              </div>
            )}
            <div className="min-h-0 flex-1">
              <ThreadList
                filter={filter}
                folder={folder}
                activeId={threadId}
                hrefFor={hrefFor}
                compact={compact}
                showMailbox={scope.kind !== "mailbox"}
              />
            </div>
          </section>

          <section
            aria-label="Conversation"
            className={cn(
              "min-w-0 flex-1 flex-col overflow-hidden rounded-3xl bg-surface",
              stacked ? (threadId ? "flex" : "hidden") : threadId ? "flex" : "hidden lg:flex",
            )}
          >
            {threadId ? (
              <ThreadView threadId={threadId} backHref={backHref} folder={folder} />
            ) : (
              <div className="grid flex-1 place-items-center text-muted-foreground">
                <span className="flex flex-col items-center gap-2 text-sm">
                  <Icon name="mail" size={32} />
                  Pick a conversation to read it.
                </span>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Phones: compose is an extended floating action button. */}
      {!threadId && !composer.isOpen && (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={spatial}
          className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 md:hidden"
        >
          <Button
            variant="primary"
            size="lg"
            icon="edit"
            className="h-14 rounded-[18px] px-5 shadow-[0_8px_24px_rgb(0_0_0/0.4)] active:not-disabled:rounded-[14px]"
            onClick={() => composer.open()}
          >
            Compose
          </Button>
        </motion.div>
      )}
    </div>
  );
}

function SearchBox({ value, onCommit }: { value: string; onCommit: (value: string) => void }) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const clear = () => {
    setText("");
    onCommit("");
  };
  return (
    <form
      className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full bg-surface-high pr-1 pl-4 md:max-w-xl"
      onSubmit={(event) => {
        event.preventDefault();
        onCommit(text.trim());
        input.current?.blur();
      }}
    >
      <Icon name="search" className="text-muted-foreground" />
      <label htmlFor="mail-search" className="sr-only">
        Search mail
      </label>
      <input
        ref={input}
        id="mail-search"
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") clear();
        }}
        placeholder="Search mail"
        className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
      />
      {text && <IconButton icon="close" label="Clear search" size="sm" onClick={clear} />}
    </form>
  );
}

function ViewMenu({ unread, onUnread }: { unread: boolean; onUnread: (on: boolean) => void }) {
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
        <DropdownMenuCheckboxItem checked={unread} onCheckedChange={onUnread}>
          Unread only
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
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
  return (
    <>
      <Button variant="destructive" size="sm" icon="delete_forever" onClick={() => setOpen(true)}>
        Empty trash
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
