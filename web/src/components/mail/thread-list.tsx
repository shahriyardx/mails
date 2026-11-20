import { animate, motion, type PanInfo, useMotionValue, useTransform } from "motion/react";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  Avatar,
  Button,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Icon,
  IconButton,
  Skeleton,
  Tooltip,
} from "@/components/kit";
import { spatial } from "@/components/kit/motion";
import { errorMessage, useThreads } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useIsTouch } from "@/lib/hooks";
import { dayGroup, displayName, formatStamp, swipeOutcome } from "@/lib/mail";
import type { Thread, ThreadFilter, ViewFolder } from "@/lib/types";
import { LabelMenu } from "./label-menu";
import { movableFolder, useThreadActions } from "./use-thread-actions";

const EMPTY: Record<ViewFolder, { icon: string; title: string }> = {
  inbox: { icon: "inbox", title: "Nothing here" },
  starred: { icon: "star", title: "Nothing starred" },
  sent: { icon: "send", title: "Nothing sent yet" },
  drafts: { icon: "draft", title: "No drafts" },
  archive: { icon: "archive", title: "Nothing archived" },
  spam: { icon: "report", title: "No spam" },
  trash: { icon: "delete", title: "Trash is empty" },
};

/**
 * The conversation list: `header` (title and chips) on top, then threads
 * grouped by day. The open thread is a raised panel with quick actions;
 * picking threads brings up a bulk bar at the bottom.
 */
export function ThreadList({
  header,
  filter,
  folder,
  activeId,
  hrefFor,
  compact,
  showMailbox,
}: {
  header?: ReactNode;
  filter: ThreadFilter;
  folder: ViewFolder;
  activeId?: string;
  hrefFor: (threadId: string, reply?: "reply") => string;
  compact: boolean;
  /** All mail: say which mailbox each thread is in. */
  showMailbox: boolean;
}) {
  const query = useThreads(filter);
  const actions = useThreadActions();
  const touch = useIsTouch();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [purging, setPurging] = useState<string[] | null>(null);
  const sentinel = useRef<HTMLLIElement>(null);
  const scroller = useRef<HTMLUListElement>(null);
  // Scrolled away from the top: the header gets a line and a soft shadow.
  const [scrolled, setScrolled] = useState(false);

  const threads = useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);
  const filterKey = JSON.stringify(filter);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new view starts with nothing picked
  useEffect(() => setSelected(new Set()), [filterKey]);

  // Infinite scroll: load the next page when the end is within 600px of
  // the list's own scroll box (the root, so the margin counts there).
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && !isFetchingNextPage && fetchNextPage(),
      { root: scroller.current, rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const ids = [...selected];
  const some = selected.size > 0;
  const all = threads.length > 0 && selected.size === threads.length;
  const from = movableFolder(folder);
  const unreadIds =
    folder === "sent" ? [] : threads.filter((t) => t.unread_count > 0).map((t) => t.id);
  const done = () => setSelected(new Set());
  const bulk = (run: () => void) => () => {
    run();
    done();
  };

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function remove(target: string[]) {
    if (folder === "trash") setPurging(target);
    else actions.trash(target);
  }

  let lastGroup = "";

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <ConfirmDialog
        open={purging !== null}
        onOpenChange={(open) => !open && setPurging(null)}
        title={
          purging?.length === 1
            ? "Delete this conversation forever?"
            : `Delete ${purging?.length} conversations forever?`
        }
        consequences="They are already in Trash. This removes their messages and attachments for good."
        confirmLabel="Delete forever"
        onConfirm={async () => {
          await actions.purge(purging ?? []);
          done();
        }}
      />

      <div
        className={cn(
          "relative z-10 border-b pb-3 transition-[border-color,box-shadow] duration-150",
          scrolled
            ? "border-border shadow-[0_6px_12px_-8px_rgb(0_0_0/0.45)]"
            : "border-transparent",
        )}
      >
        {header}
      </div>

      <ul
        ref={scroller}
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 2)}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-1 pb-24 md:pb-6"
      >
        {query.isPending &&
          Array.from({ length: 8 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
            <li key={i} className="mx-2.5 flex gap-3 px-3 py-3">
              <Skeleton className={cn("rounded-full", compact ? "size-8" : "size-11.5")} />
              <div className="flex-1 space-y-2 pt-1">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </li>
          ))}
        {query.isError && (
          <EmptyState
            icon="error"
            title="Could not load conversations"
            body={errorMessage(query.error)}
            action={<Button onClick={() => query.refetch()}>Try again</Button>}
          />
        )}
        {query.isSuccess && threads.length === 0 && (
          <EmptyState
            {...(filter.q
              ? { icon: "search", title: "No matches", body: `Nothing matches “${filter.q}” here.` }
              : EMPTY[folder])}
          />
        )}
        {threads.map((thread) => {
          const group = dayGroup(thread.last_message_at);
          const first = lastGroup === "";
          const heading = group !== lastGroup;
          lastGroup = group;
          return (
            <Fragment key={thread.id}>
              {heading && (
                <li className="flex items-baseline justify-between px-5.5 pt-3.5 pb-1 font-display text-xs font-semibold">
                  <span className="text-soft-foreground">{group}</span>
                  {first && unreadIds.length > 0 && (
                    <button
                      type="button"
                      className="rounded text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={() => actions.setRead(unreadIds, true)}
                    >
                      Mark all read
                    </button>
                  )}
                </li>
              )}
              <Row
                thread={thread}
                folder={folder}
                href={hrefFor(thread.id)}
                replyHref={hrefFor(thread.id, "reply")}
                active={thread.id === activeId}
                checked={selected.has(thread.id)}
                selecting={some}
                compact={compact}
                showMailbox={showMailbox}
                swipe={touch}
                onToggle={() => toggle(thread.id)}
                onArchive={() => actions.move([thread.id], "archive", from)}
                onDelete={() => remove([thread.id])}
                onStar={() => actions.setStarred([thread.id], !thread.is_starred)}
                onRead={() => actions.setRead([thread.id], thread.unread_count > 0)}
              />
            </Fragment>
          );
        })}
        {hasNextPage && (
          <li ref={sentinel} className="flex justify-center py-4">
            <Icon name="progress_activity" className="animate-spin text-muted-foreground" />
          </li>
        )}
      </ul>

      {some && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spatial}
          className="absolute inset-x-3 bottom-3 z-20 flex items-center gap-0.5 overflow-x-auto rounded-xl border border-border bg-surface-high p-1 shadow-[0_12px_32px_var(--shadow)] max-md:bottom-[calc(5rem+env(safe-area-inset-bottom))]"
        >
          <Checkbox
            checked={all}
            indeterminate={!all}
            onCheckedChange={() => setSelected(all ? new Set() : new Set(threads.map((t) => t.id)))}
            aria-label="Select all"
            className="mx-2.5"
          />
          <span className="mr-1 font-mono text-xs text-muted-foreground tabular-nums">
            {selected.size}
          </span>
          <Bulk
            icon="mark_email_read"
            label="Mark read"
            onClick={bulk(() => actions.setRead(ids, true))}
          />
          <Bulk
            icon="mark_email_unread"
            label="Mark unread"
            onClick={bulk(() => actions.setRead(ids, false))}
          />
          <Bulk icon="star" label="Star" onClick={bulk(() => actions.setStarred(ids, true))} />
          {folder === "archive" || folder === "spam" || folder === "trash" ? (
            <Bulk
              icon="move_to_inbox"
              label="Move to inbox"
              onClick={() => {
                if (folder === "trash") actions.restore(ids);
                else actions.move(ids, "inbox", from);
                done();
              }}
            />
          ) : (
            <Bulk
              icon="archive"
              label="Archive"
              onClick={bulk(() => actions.move(ids, "archive", from))}
            />
          )}
          {folder !== "spam" && (
            <Bulk
              icon="report"
              label="Report spam"
              onClick={bulk(() => actions.move(ids, "spam", from))}
            />
          )}
          <LabelMenu threadIds={ids} onDone={done} />
          <Bulk
            icon={folder === "trash" ? "delete_forever" : "delete"}
            label={folder === "trash" ? "Delete forever" : "Delete"}
            onClick={() => {
              remove(ids);
              if (folder !== "trash") done();
            }}
          />
          <span className="ml-auto">
            <Bulk icon="close" label="Clear selection" onClick={done} />
          </span>
        </motion.div>
      )}
    </div>
  );
}

function Bulk({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <Tooltip label={label}>
      <IconButton icon={icon} label={label} size="sm" onClick={onClick} />
    </Tooltip>
  );
}

const SWIPE = 96;

function Row({
  thread,
  folder,
  href,
  replyHref,
  active,
  checked,
  selecting,
  compact,
  showMailbox,
  swipe,
  onToggle,
  onArchive,
  onDelete,
  onStar,
  onRead,
}: {
  thread: Thread;
  folder: ViewFolder;
  href: string;
  replyHref: string;
  active: boolean;
  checked: boolean;
  selecting: boolean;
  compact: boolean;
  showMailbox: boolean;
  swipe: boolean;
  onToggle: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onStar: () => void;
  onRead: () => void;
}) {
  // Nothing in Sent is unread: you wrote it.
  const unread = folder !== "sent" && thread.unread_count > 0;
  // The other person, not you: skip the thread's own mailbox address.
  const own = thread.mailbox.toLowerCase();
  const sender =
    thread.participants?.find((p) => p.address.toLowerCase() !== own) ?? thread.participants?.[0];
  const x = useMotionValue(0);
  const archiveShown = useTransform(x, [-SWIPE, -24, 0], [1, 0.4, 0]);
  const deleteShown = useTransform(x, [0, 24, SWIPE], [0, 0.4, 1]);

  // Touch: swipe left archives, right moves to trash; the action shows underneath.
  function onDragEnd(_: unknown, info: PanInfo) {
    const { action, slideOut } = swipeOutcome(info.offset.x, info.velocity.x, folder, SWIPE);
    const run = action === "archive" ? onArchive : action === "delete" ? onDelete : null;
    if (!run) {
      void animate(x, 0, spatial);
    } else if (slideOut) {
      void animate(x, Math.sign(info.offset.x) * window.innerWidth, spatial).then(run);
    } else {
      // Trash: delete asks first, so the row comes back while the dialog is up.
      run();
      void animate(x, 0, spatial);
    }
  }

  return (
    <li className="relative mx-2.5 my-0.5" data-thread-id={thread.id}>
      {swipe && (
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-between rounded-xl bg-tonal px-5"
        >
          <motion.span
            style={{ opacity: deleteShown }}
            className="flex items-center gap-2 text-destructive"
          >
            <Icon name="delete" /> Trash
          </motion.span>
          <motion.span style={{ opacity: archiveShown }} className="flex items-center gap-2">
            Archive <Icon name="archive" />
          </motion.span>
        </div>
      )}
      <motion.div
        style={{ x }}
        drag={swipe && !selecting ? "x" : false}
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.9}
        onDragEnd={onDragEnd}
        className={cn(
          "group relative flex items-start gap-3 rounded-xl px-3 transition-colors",
          compact ? "py-2" : "py-2.75",
          active
            ? "bg-surface shadow-[inset_0_0_0_1px_var(--border)]"
            : checked
              ? "bg-selected"
              : "bg-background hover:bg-surface",
        )}
      >
        {active && (
          <span
            aria-hidden
            className="absolute top-3 bottom-3 -left-2.5 w-0.75 rounded-r-[3px] bg-primary"
          />
        )}
        {/* The avatar turns into a checkbox when reached for, or while picking. */}
        <span className={cn("relative z-10 shrink-0", compact ? "size-8" : "size-11.5")}>
          <Avatar
            size={compact ? "md" : "xl"}
            name={sender?.name}
            address={sender?.address}
            className={cn(
              "absolute inset-0 transition-opacity",
              checked || selecting ? "opacity-0" : "md:group-hover:opacity-0",
            )}
          />
          <span
            className={cn(
              "absolute inset-0 grid place-items-center transition-opacity",
              checked || selecting
                ? "opacity-100"
                : "opacity-0 md:group-hover:opacity-100 focus-within:opacity-100",
            )}
          >
            <Checkbox
              checked={checked}
              onCheckedChange={onToggle}
              aria-label={`Select ${thread.subject || "conversation"}`}
            />
          </span>
        </span>

        <div className="min-w-0 flex-1">
          <Link
            to={href}
            draggable={false}
            onClick={(event) => {
              if (selecting) {
                event.preventDefault();
                onToggle();
              }
            }}
            className="block min-w-0 outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
          >
            <span className="flex min-w-0 items-baseline gap-2.5">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  unread ? "font-bold text-foreground" : "font-medium text-soft-foreground",
                )}
              >
                {folder === "sent" || folder === "drafts"
                  ? (thread.participants ?? []).map(displayName).join(", ") || "(no recipients)"
                  : displayName(sender)}
                {thread.message_count > 1 && (
                  <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">
                    {thread.message_count}
                  </span>
                )}
              </span>
              {showMailbox && (
                <span
                  title={thread.mailbox}
                  className="size-2 shrink-0 self-center rounded-[2px]"
                  style={{ background: thread.mailbox_color }}
                >
                  <span className="sr-only">{thread.mailbox}</span>
                </span>
              )}
              {thread.has_attachments && (
                <Icon name="attach_file" size={15} className="self-center text-muted-foreground" />
              )}
              {thread.is_starred && (
                <Icon name="star" size={15} filled className="self-center text-accent" />
              )}
              <span
                className={cn(
                  "shrink-0 font-mono text-xs tabular-nums",
                  unread ? "font-medium text-accent" : "text-muted-foreground",
                  !active && "md:group-hover:invisible",
                )}
              >
                {formatStamp(thread.last_message_at)}
              </span>
            </span>
            <span
              className={cn(
                "block truncate text-foreground",
                unread && "font-semibold",
                compact && "text-[13px]",
              )}
            >
              {thread.subject || "(no subject)"}
              {unread && <span className="sr-only"> (unread)</span>}
            </span>
            {!compact && thread.snippet && (
              <span className="block truncate text-[13px] text-muted-foreground">
                {thread.snippet}
              </span>
            )}
            {!compact && (thread.labels?.length ?? 0) > 0 && (
              <span className="mt-1.5 flex flex-wrap gap-1">
                {thread.labels!.map((label) => (
                  <span
                    key={label.id}
                    className="flex items-center gap-1.5 rounded-md bg-tonal px-1.5 py-px text-[11px] font-medium text-soft-foreground"
                  >
                    <span
                      className="size-1.5 rounded-[2px]"
                      style={{ background: label.color }}
                      aria-hidden
                    />
                    {label.name}
                  </span>
                ))}
              </span>
            )}
          </Link>

          {/* The open thread's quick actions. */}
          {active && !selecting && (
            <span className="relative z-10 mt-2 flex flex-wrap gap-1.5">
              {folder !== "drafts" && (
                <Button
                  size="xs"
                  icon="reply"
                  render={<Link to={replyHref} />}
                  nativeButton={false}
                >
                  Reply
                </Button>
              )}
              {folder !== "trash" && folder !== "archive" && (
                <Button size="xs" icon="archive" onClick={onArchive}>
                  Archive
                </Button>
              )}
              <Button size="xs" icon="star" onClick={onStar}>
                {thread.is_starred ? "Unstar" : "Star"}
              </Button>
            </span>
          )}
        </div>

        {/* Hover actions take the timestamp's place (pointer screens). */}
        {!active && (
          <span className="absolute top-2 right-2 z-10 hidden items-center gap-0.5 rounded-lg border border-border bg-surface-high p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 md:flex">
            <IconButton
              size="xs"
              icon="star"
              filled={thread.is_starred}
              label={thread.is_starred ? "Unstar" : "Star"}
              onClick={onStar}
            />
            {folder !== "trash" && (
              <IconButton size="xs" icon="archive" label="Archive" onClick={onArchive} />
            )}
            <IconButton
              size="xs"
              icon={thread.unread_count > 0 ? "mark_email_read" : "mark_email_unread"}
              label={thread.unread_count > 0 ? "Mark read" : "Mark unread"}
              onClick={onRead}
            />
            <IconButton
              size="xs"
              icon={folder === "trash" ? "delete_forever" : "delete"}
              label={folder === "trash" ? "Delete forever" : "Delete"}
              onClick={onDelete}
            />
          </span>
        )}
      </motion.div>
    </li>
  );
}
