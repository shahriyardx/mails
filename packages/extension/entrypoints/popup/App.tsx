import { Button, Chip, EmptyState, Icon, IconButton, Logo, RowSkeleton } from "@/components/kit";
import { MailboxPicker } from "@/components/mailbox-picker";
import { ThreadRow } from "@/components/thread-row";
import { ThreadView } from "@/components/thread-view";
import {
  ApiError,
  type ThreadPatch,
  deleteThread,
  getThread,
  listMailboxes,
  listThreads,
  patchThread,
} from "@/lib/api";
import { cacheList, cacheMailboxes, cachedList, cachedMailboxes } from "@/lib/cache";
import { cx, dayGroup } from "@/lib/format";
import { openTab, refreshBadge, useDebounced, useSettings } from "@/lib/hooks";
import { isConnected, watchesNothing } from "@/lib/settings";
import { useTheme } from "@/lib/theme";
import {
  type ApiMailbox,
  type ApiThread,
  VIEWS,
  VIEW_FOLDER,
  VIEW_LABEL,
  type View,
} from "@/lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";

/**
 * The popup.
 *
 * One page that is either 400 pixels of toolbar or a full tab, and the only
 * difference between the two is whether the list and the conversation sit
 * side by side. Everything else — the views, the triage, the search — is the
 * same code, because a second layout is a second set of bugs.
 */

const PAGE = 25;

export function App({ inTab }: { inTab: boolean }) {
  const { settings, update } = useSettings();
  const theme = useTheme(settings?.theme);

  const [view, setView] = useState<View>("inbox");
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const term = useDebounced(search);

  const [threads, setThreads] = useState<ApiThread[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mailboxes, setMailboxes] = useState<ApiMailbox[]>([]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState<ApiThread | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const [wide, setWide] = useState(false);

  // Answers can land out of order (click A, then B, and A answers last).
  // Each request takes a number; only the newest may change the screen.
  const listRequest = useRef(0);
  const openRequest = useRef(0);

  // Two panes only when there is room for two. The popup never has it.
  useEffect(() => {
    if (!inTab) return;
    const check = () => setWide(window.innerWidth >= 860);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [inTab]);

  const connected = settings ? isConnected(settings) : false;

  /* ------------------------------------------------------------- the list */

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!settings || !isConnected(settings)) return;
      const request = ++listRequest.current;
      if (!options.silent) setLoading(true);
      setError(null);
      try {
        const result = await listThreads(settings, view, { search: term, limit: PAGE });
        if (request !== listRequest.current) return;
        setThreads(result.threads);
        setCursor(result.nextCursor);
        void cacheList(settings, view, term, result.threads);
      } catch (caught) {
        if (request !== listRequest.current) return;
        setError(caught instanceof ApiError ? caught.message : "Could not load your mail.");
        setThreads([]);
        setCursor(null);
      } finally {
        if (request === listRequest.current) setLoading(false);
      }
    },
    [settings, view, term],
  );

  /**
   * What this view looked like last time, on screen before the request that
   * replaces it has even been sent.
   *
   * The popup is built from scratch on every open, so without this each one
   * begins with four grey rows for as long as the round trip takes. The fetch
   * still happens, and still wins; it just no longer has an empty screen to
   * itself.
   */
  useEffect(() => {
    if (!settings || !isConnected(settings)) return;
    let alive = true;

    void cachedList(settings, view, term).then((entry) => {
      if (!alive || !entry || entry.threads.length === 0) return;
      // Only ahead of the real answer. Once that has landed it stands.
      setThreads((current) => (current.length === 0 ? entry.threads : current));
      setLoading(false);
    });

    void load();

    return () => {
      alive = false;
    };
  }, [load, settings, view, term]);

  // The mailbox picker only makes sense once we know what there is to pick.
  useEffect(() => {
    if (!settings || !isConnected(settings)) return;
    let alive = true;

    void cachedMailboxes().then((rows) => {
      if (alive && rows) setMailboxes((current) => (current.length === 0 ? rows : current));
    });

    void listMailboxes(settings)
      .then((rows) => {
        if (!alive) return;
        setMailboxes(rows);
        void cacheMailboxes(rows);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [settings]);

  async function loadMore() {
    if (!settings || !cursor || loadingMore) return;
    // The next page of this list: a newer load replaces the list, and wins.
    const request = listRequest.current;
    setLoadingMore(true);
    try {
      const result = await listThreads(settings, view, {
        search: term,
        limit: PAGE,
        cursor,
      });
      if (request !== listRequest.current) return;
      setThreads((current) => [...current, ...result.threads]);
      setCursor(result.nextCursor);
    } catch {
      if (request === listRequest.current) setCursor(null);
    } finally {
      setLoadingMore(false);
    }
  }

  /* -------------------------------------------------------- the open thread */

  const openThread = useCallback(
    async (id: string) => {
      if (!settings) return;
      const request = ++openRequest.current;
      const current = () => request === openRequest.current;
      setOpenId(id);
      setOpen(null);
      setOpenError(null);
      setOpenLoading(true);
      try {
        const detail = await getThread(settings, id);
        if (!current()) return;
        setOpen(detail);

        if (detail.unread_count > 0) {
          await patchThread(settings, id, { is_read: true });
          /**
           * The row is changed where it stands rather than the list being
           * fetched again. In the unread view a refetch would make the thing
           * just opened disappear from under the reader, which is a bad enough
           * surprise in the web app that it was fixed there too.
           */
          setThreads((current) =>
            current.map((row) => (row.id === id ? { ...row, unread_count: 0 } : row)),
          );
          if (current()) setOpen((open) => (open ? { ...open, unread_count: 0 } : open));
          refreshBadge();
        }
      } catch (caught) {
        if (current()) {
          setOpenError(caught instanceof ApiError ? caught.message : "Could not open it.");
        }
      } finally {
        if (current()) setOpenLoading(false);
      }
    },
    [settings],
  );

  const closeThread = useCallback(() => {
    openRequest.current += 1; // an answer still on its way is for nothing now
    setOpenId(null);
    setOpen(null);
    setOpenError(null);
    setOpenLoading(false);
  }, []);

  /* ------------------------------------------------------------- the actions */

  const patch = useCallback(
    async (id: string, changes: ThreadPatch) => {
      if (!settings) return;

      // Moving a conversation out of the view takes the row with it; anything
      // else is a change to the row that stays.
      const leaves = changes.folder !== undefined && changes.folder !== VIEW_FOLDER[view];

      setThreads((current) =>
        leaves
          ? current.filter((row) => row.id !== id)
          : current.map((row) =>
              row.id === id
                ? {
                    ...row,
                    ...(changes.is_starred !== undefined ? { is_starred: changes.is_starred } : {}),
                    ...(changes.is_read !== undefined
                      ? { unread_count: changes.is_read ? 0 : Math.max(1, row.unread_count) }
                      : {}),
                  }
                : row,
            ),
      );

      if (leaves && openId === id) closeThread();
      else if (openId === id) {
        setOpen((current) =>
          current
            ? {
                ...current,
                ...(changes.is_starred !== undefined ? { is_starred: changes.is_starred } : {}),
                ...(changes.is_read !== undefined ? { unread_count: changes.is_read ? 0 : 1 } : {}),
              }
            : current,
        );
      }

      try {
        await patchThread(settings, id, changes);
        refreshBadge();
      } catch {
        // The server said no, so the list is no longer what is on screen.
        void load({ silent: true });
      }
    },
    [settings, view, openId, closeThread, load],
  );

  const trash = useCallback(
    async (id: string) => {
      if (!settings) return;
      setThreads((current) => current.filter((row) => row.id !== id));
      if (openId === id) closeThread();
      try {
        await deleteThread(settings, id, view === "trash");
        refreshBadge();
      } catch {
        void load({ silent: true });
      }
    },
    [settings, view, openId, closeThread, load],
  );

  /* ---------------------------------------------------------------- render */

  if (!settings) {
    return <div className="h-full bg-background" />;
  }

  if (!connected) {
    return <Connect />;
  }

  /*
   * The rows on their own, with no navigation attached.
   *
   * The popup wears a row of pills above them and the tab wears a rail beside
   * them, and neither layout should have to own a second copy of the list.
   */
  const rows = (
    <div className="min-h-0 flex-1 overflow-y-auto pb-2">
      {loading ? (
        <div className="pt-2">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      ) : error ? (
        <EmptyState
          title="That did not work"
          body={error}
          action={
            <Button icon="refresh" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : watchesNothing(settings) ? (
        /* Not the same as an empty inbox, and saying "all caught up" here
             would be telling somebody their mail is read when it is hidden. */
        <EmptyState
          icon="all_inbox"
          title="No mailboxes picked"
          body="Nothing is being watched, so there is nothing to show."
          action={
            <Button icon="settings" onClick={() => void browser.runtime.openOptionsPage()}>
              Pick mailboxes
            </Button>
          }
        />
      ) : threads.length === 0 ? (
        <EmptyState
          icon={term ? "search" : "inbox"}
          title={term ? "Nothing matched" : `No mail in ${VIEW_LABEL[view].toLowerCase()}`}
          body={term ? "Try a different search." : "You are all caught up."}
        />
      ) : (
        <>
          {threads.map((thread, index) => {
            const group = dayGroup(thread.last_message_at);
            const heading = index === 0 || group !== dayGroup(threads[index - 1]!.last_message_at);
            return (
              <div key={thread.id}>
                {heading ? (
                  <div className="px-5 pt-3 pb-1 font-display text-xs font-semibold text-soft-foreground">
                    {group}
                  </div>
                ) : null}
                <ThreadRow
                  thread={thread}
                  view={view}
                  selected={thread.id === openId}
                  onOpen={() => void openThread(thread.id)}
                  onStar={() => void patch(thread.id, { is_starred: !thread.is_starred })}
                  onArchive={() => void patch(thread.id, { folder: "archive" })}
                  onTrash={() => void trash(thread.id)}
                />
              </div>
            );
          })}

          {cursor ? (
            <div className="px-4 py-3">
              <Button
                variant="outline"
                className="w-full"
                busy={loadingMore}
                onClick={() => void loadMore()}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );

  const list = (
    <div className="flex h-full min-h-0 flex-col">
      <ViewTabs view={view} onChange={setView} />
      {rows}
    </div>
  );

  const reading = (
    <ThreadView
      thread={open}
      loading={openLoading}
      error={openError}
      view={view}
      settings={settings}
      theme={theme}
      showBack={!wide}
      onBack={closeThread}
      roomy={wide}
      onPatch={(changes) => openId && void patch(openId, changes)}
      onTrash={() => openId && void trash(openId)}
    />
  );

  /*
   * The roomy layout: a rail of places, a column of conversations, and the
   * one being read. Not the popup stretched sideways — at this width the row
   * of pills is a hairline of clipped text and the header is a crowded strip
   * of icons a metre from the thing they act on.
   */
  if (wide) {
    return (
      <div className="flex h-full bg-background">
        <Rail
          view={view}
          onChange={(next) => {
            setView(next);
            closeThread();
          }}
          onOpenApp={() => openTab(`${settings.baseUrl}/mail/all/inbox`)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
            view={view}
            search={search}
            onSearch={setSearch}
            loading={loading}
            onRefresh={() => {
              void load();
              refreshBadge();
            }}
            mailboxes={mailboxes}
            watchAll={settings.watchAll}
            chosen={settings.mailboxIds}
            onChoose={(choice) => void update(choice)}
          />

          <div className="flex min-h-0 flex-1">
            <div className="flex w-[380px] shrink-0 flex-col border-r border-border xl:w-[420px]">
              {rows}
            </div>
            <div className="min-w-0 flex-1">{reading}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <Header
        inTab={inTab}
        searching={searching}
        search={search}
        onSearch={setSearch}
        onSearching={setSearching}
        onRefresh={() => {
          void load();
          refreshBadge();
        }}
        loading={loading}
        mailboxes={mailboxes}
        watchAll={settings.watchAll}
        chosen={settings.mailboxIds}
        onChoose={(choice) => void update(choice)}
        onOpenApp={() => openTab(`${settings.baseUrl}/mail/all/inbox`)}
      />

      <div className="min-h-0 flex-1">
        {openId ? <div className="h-full animate-fade-in">{reading}</div> : list}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ header */

interface HeaderProps {
  inTab: boolean;
  searching: boolean;
  search: string;
  loading: boolean;
  mailboxes: ApiMailbox[];
  watchAll: boolean;
  chosen: string[];
  onSearch: (value: string) => void;
  onSearching: (value: boolean) => void;
  onChoose: (choice: { watchAll: boolean; mailboxIds?: string[] }) => void;
  onRefresh: () => void;
  onOpenApp: () => void;
}

function Header({
  inTab,
  searching,
  search,
  loading,
  mailboxes,
  watchAll,
  chosen,
  onSearch,
  onSearching,
  onChoose,
  onRefresh,
  onOpenApp,
}: HeaderProps) {
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searching) box.current?.focus();
  }, [searching]);

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
      {searching ? (
        <>
          <Icon name="search" className="ml-1.5 text-muted-foreground" />
          <input
            ref={box}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onSearch("");
                onSearching(false);
              }
            }}
            placeholder="Search mail"
            aria-label="Search mail"
            className="h-8 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          <IconButton
            icon="close"
            label="Close search"
            onClick={() => {
              onSearch("");
              onSearching(false);
            }}
          />
        </>
      ) : (
        <>
          <span className="mr-1 ml-2 flex items-center gap-2.5">
            <Logo />
            <span className="font-display text-[16px] font-bold tracking-[-0.02em]">Mails</span>
          </span>

          {mailboxes.length > 1 ? (
            <MailboxPicker
              mailboxes={mailboxes}
              watchAll={watchAll}
              chosen={chosen}
              onChoose={onChoose}
            />
          ) : null}

          <div className="ml-auto flex items-center gap-0.5">
            <IconButton icon="search" label="Search" onClick={() => onSearching(true)} />
            <IconButton icon="refresh" label="Refresh" spin={loading} onClick={onRefresh} />
            {!inTab ? (
              <IconButton
                icon="open_in_full"
                label="Open in a tab"
                onClick={() => openTab(`${browser.runtime.getURL("/popup.html")}?tab=1`)}
              />
            ) : null}
            <IconButton icon="open_in_new" label="Open Mails" onClick={onOpenApp} />
            <IconButton
              icon="settings"
              label="Settings"
              onClick={() => void browser.runtime.openOptionsPage()}
            />
          </div>
        </>
      )}
    </header>
  );
}

/* -------------------------------------------------------------- the tab rail */

const VIEW_ICON: Record<View, string> = {
  inbox: "inbox",
  unread: "mark_email_unread",
  starred: "star",
  sent: "send",
  archive: "archive",
  spam: "report",
  trash: "delete",
};

/**
 * Where you can go, down the left: the web sidebar's folder rows (the active
 * one is a panel with a hairline). The popup shows the same seven as chips.
 */
function Rail({
  view,
  onChange,
  onOpenApp,
}: {
  view: View;
  onChange: (value: View) => void;
  onOpenApp: () => void;
}) {
  return (
    <nav className="flex w-[232px] shrink-0 flex-col border-r border-border">
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-5">
        <Logo />
        <span className="font-display text-[19px] font-bold tracking-[-0.02em]">Mails</span>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-1">
        {VIEWS.map((entry) => (
          <RailRow
            key={entry}
            icon={VIEW_ICON[entry]}
            label={VIEW_LABEL[entry]}
            active={entry === view}
            onClick={() => onChange(entry)}
          />
        ))}
      </div>

      <div className="shrink-0 space-y-0.5 border-t border-border px-3 py-2">
        <RailRow icon="open_in_new" label="Open Mails" onClick={onOpenApp} />
        <RailRow
          icon="settings"
          label="Settings"
          onClick={() => void browser.runtime.openOptionsPage()}
        />
      </div>
    </nav>
  );
}

function RailRow({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: string;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
        active
          ? "bg-surface text-foreground shadow-[inset_0_0_0_1px_var(--border)]"
          : "text-soft-foreground hover:bg-surface hover:text-foreground",
      )}
    >
      <Icon name={icon} filled={active} className={active ? "text-accent" : undefined} />
      {label}
    </button>
  );
}

/**
 * The bar above both columns: where you are, and how to search it. Search is
 * a real box here; there is width for it.
 */
function TopBar({
  view,
  search,
  onSearch,
  loading,
  onRefresh,
  mailboxes,
  watchAll,
  chosen,
  onChoose,
}: {
  view: View;
  search: string;
  onSearch: (value: string) => void;
  loading: boolean;
  onRefresh: () => void;
  mailboxes: ApiMailbox[];
  watchAll: boolean;
  chosen: string[];
  onChoose: (choice: { watchAll: boolean; mailboxIds?: string[] }) => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      <h1 className="text-[20px] font-bold">{VIEW_LABEL[view]}</h1>

      {mailboxes.length > 1 ? (
        <MailboxPicker
          mailboxes={mailboxes}
          watchAll={watchAll}
          chosen={chosen}
          onChoose={onChoose}
        />
      ) : null}

      <label className="ml-auto flex h-9 w-full max-w-[380px] items-center gap-2 rounded-lg border border-input bg-field px-2.5 focus-within:border-primary">
        <Icon name="search" className="text-muted-foreground" />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && onSearch("")}
          placeholder="Search mail"
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {search ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onSearch("")}
            className="grid shrink-0 place-items-center text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon name="close" size={16} />
          </button>
        ) : null}
      </label>

      <IconButton icon="refresh" label="Refresh" spin={loading} onClick={onRefresh} />
    </header>
  );
}

/* ------------------------------------------------------------------- views */

function ViewTabs({ view, onChange }: { view: View; onChange: (value: View) => void }) {
  return (
    <div className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pt-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {VIEWS.map((entry) => (
        <Chip key={entry} active={entry === view} onClick={() => onChange(entry)}>
          {VIEW_LABEL[entry]}
        </Chip>
      ))}
    </div>
  );
}

/* --------------------------------------------------------- not connected yet */

function Connect() {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <Logo />
        <span className="font-display text-[16px] font-bold tracking-[-0.02em]">Mails</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-10 text-center">
        <div className="mb-1 grid size-12 place-items-center rounded-full bg-accent-soft text-accent">
          <Icon name="link" size={24} />
        </div>
        <h1 className="text-[20px] font-bold">Connect to Mails</h1>
        <p className="text-[13px] text-muted-foreground">
          Point this at your own instance with its address and an API key, and your inbox turns up
          here.
        </p>
        <Button
          variant="primary"
          size="md"
          icon="key"
          className="mt-2"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          Set it up
        </Button>
      </div>
    </div>
  );
}
