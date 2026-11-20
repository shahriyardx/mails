import { animate, motion, type PanInfo, useMotionValue, useTransform } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { displayName, formatStamp } from "@/lib/mail";
import type { Thread, ThreadFilter, ViewFolder } from "@/lib/types";
import { LabelMenu } from "./label-menu";
import { movableFolder, useThreadActions } from "./use-thread-actions";

const EMPTY: Record<ViewFolder, { icon: string; title: string; body: string }> = {
  inbox: {
    icon: "inbox",
    title: "Nothing here",
    body: "New mail appears the moment the Cloudflare worker delivers it.",
  },
  starred: {
    icon: "star",
    title: "Nothing starred",
    body: "Star a conversation and it collects here.",
  },
  sent: {
    icon: "send",
    title: "Nothing sent yet",
    body: "Messages you send through SES appear here.",
  },
  drafts: { icon: "draft", title: "No drafts", body: "Drafts save themselves as you type." },
  archive: {
    icon: "archive",
    title: "Nothing archived",
    body: "Archived conversations are kept out of the inbox, not deleted.",
  },
  spam: { icon: "report", title: "No spam", body: "Conversations you report land here." },
  trash: {
    icon: "delete",
    title: "Trash is empty",
    body: "Deleted conversations rest here before they go for good.",
  },
};

export function ThreadList({
  filter,
  folder,
  activeId,
  hrefFor,
  compact,
  showMailbox,
}: {
  filter: ThreadFilter;
  folder: ViewFolder;
  activeId?: string;
  hrefFor: (threadId: string) => string;
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

  const threads = useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);
  const filterKey = JSON.stringify(filter);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new view starts with nothing picked
  useEffect(() => setSelected(new Set()), [filterKey]);

  // Infinite scroll: load the next page as the end comes into view.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && !isFetchingNextPage && fetchNextPage(),
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const ids = [...selected];
  const some = selected.size > 0;
  const all = threads.length > 0 && selected.size === threads.length;
  const from = movableFolder(folder);
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

  return (
    <div className="flex h-full min-h-0 flex-col">
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

      {/* The toolbar never moves the list: it is there with or without a selection. */}
      <div className="flex h-12 shrink-0 items-center gap-0.5 px-3">
        <Checkbox
          checked={all}
          indeterminate={some && !all}
          onCheckedChange={() => setSelected(all ? new Set() : new Set(threads.map((t) => t.id)))}
          aria-label="Select all"
          className="mx-2.5"
        />
        <span className="w-6 text-xs text-muted-foreground tabular-nums">
          {some ? selected.size : ""}
        </span>
        <Bulk
          icon="mark_email_read"
          label="Mark read"
          disabled={!some}
          onClick={bulk(() => actions.setRead(ids, true))}
        />
        <Bulk
          icon="mark_email_unread"
          label="Mark unread"
          disabled={!some}
          onClick={bulk(() => actions.setRead(ids, false))}
        />
        <Bulk
          icon="star"
          label="Star"
          disabled={!some}
          onClick={bulk(() => actions.setStarred(ids, true))}
        />
        {folder === "archive" || folder === "spam" || folder === "trash" ? (
          <Bulk
            icon="move_to_inbox"
            label="Move to inbox"
            disabled={!some}
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
            disabled={!some}
            onClick={bulk(() => actions.move(ids, "archive", from))}
          />
        )}
        {folder !== "spam" && (
          <Bulk
            icon="report"
            label="Report spam"
            disabled={!some}
            onClick={bulk(() => actions.move(ids, "spam", from))}
          />
        )}
        <LabelMenu threadIds={ids} onDone={done} />
        <Bulk
          icon={folder === "trash" ? "delete_forever" : "delete"}
          label={folder === "trash" ? "Delete forever" : "Delete"}
          disabled={!some}
          onClick={() => {
            remove(ids);
            if (folder !== "trash") done();
          }}
        />
        <span className="ml-auto">
          <Bulk
            icon="refresh"
            label="Refresh"
            loading={query.isRefetching}
            onClick={() => query.refetch()}
          />
        </span>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-24 md:pb-3">
        {query.isPending &&
          Array.from({ length: 8 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
            <li key={i} className="flex gap-3 px-3 py-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-2">
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
        {threads.map((thread) => (
          <Row
            key={thread.id}
            thread={thread}
            folder={folder}
            href={hrefFor(thread.id)}
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
        ))}
        {hasNextPage && (
          <li ref={sentinel} className="flex justify-center py-4">
            <Icon name="progress_activity" className="animate-spin text-muted-foreground" />
          </li>
        )}
      </ul>
    </div>
  );
}

function Bulk({
  icon,
  label,
  onClick,
  disabled,
  loading,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <IconButton
        icon={icon}
        label={label}
        disabled={disabled}
        loading={loading}
        onClick={onClick}
      />
    </Tooltip>
  );
}

const SWIPE = 96;

function Row({
  thread,
  folder,
  href,
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
  const sender = thread.participants?.[0];
  const x = useMotionValue(0);
  const archiveShown = useTransform(x, [-SWIPE, -24, 0], [1, 0.4, 0]);
  const deleteShown = useTransform(x, [0, 24, SWIPE], [0, 0.4, 1]);

  // Touch: swipe left archives, right moves to trash; the action shows underneath.
  function onDragEnd(_: unknown, info: PanInfo) {
    const far = Math.abs(info.offset.x) > SWIPE || Math.abs(info.velocity.x) > 600;
    if (far && info.offset.x < 0) {
      void animate(x, -window.innerWidth, spatial).then(onArchive);
    } else if (far && info.offset.x > 0) {
      void animate(x, window.innerWidth, spatial).then(onDelete);
    } else {
      void animate(x, 0, spatial);
    }
  }

  return (
    <li className="relative">
      {swipe && (
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-between rounded-2xl bg-tonal px-5"
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
          "group relative flex items-start gap-3 rounded-2xl px-3 transition-colors",
          compact ? "py-1.5" : "py-3",
          active ? "bg-selected" : checked ? "bg-tonal" : "bg-surface hover:bg-box",
        )}
      >
        {/* The avatar turns into a checkbox when reached for, or while picking. */}
        <span className={cn("relative z-10 mt-0.5 shrink-0", compact ? "size-6" : "size-8")}>
          <Avatar
            size={compact ? "sm" : "md"}
            name={sender?.name}
            address={sender?.address}
            className={cn(
              "absolute inset-0 transition-opacity",
              checked || selecting ? "opacity-0" : "group-hover:opacity-0",
            )}
          />
          <span
            className={cn(
              "absolute inset-0 grid place-items-center transition-opacity",
              checked || selecting
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
            )}
          >
            <Checkbox
              checked={checked}
              onCheckedChange={onToggle}
              aria-label={`Select ${thread.subject || "conversation"}`}
            />
          </span>
        </span>

        <Link
          to={href}
          draggable={false}
          onClick={(event) => {
            if (selecting) {
              event.preventDefault();
              onToggle();
            }
          }}
          className="min-w-0 flex-1 outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:after:outline-2 focus-visible:after:outline-ring"
        >
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[13px]",
                unread ? "font-semibold" : "text-muted-foreground",
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
              <span className="hidden shrink-0 truncate font-mono text-[11px] text-muted-foreground sm:inline">
                {thread.mailbox}
              </span>
            )}
            {thread.has_attachments && (
              <Icon name="attach_file" size={16} className="text-muted-foreground" />
            )}
            {thread.is_starred && <Icon name="star" size={16} filled />}
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums group-hover:invisible">
              {formatStamp(thread.last_message_at)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                unread ? "font-semibold" : "text-foreground/90",
              )}
            >
              {thread.subject || "(no subject)"}
            </span>
            {unread && (
              <span className="size-2 shrink-0 rounded-full bg-foreground">
                <span className="sr-only">Unread</span>
              </span>
            )}
          </span>
          {!compact && thread.snippet && (
            <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
              {thread.snippet}
            </span>
          )}
          {!compact && (thread.labels?.length ?? 0) > 0 && (
            <span className="mt-1.5 flex flex-wrap gap-1">
              {thread.labels!.map((label) => (
                <span
                  key={label.id}
                  className="flex items-center gap-1 rounded-full bg-tonal px-2 py-px text-[11px] text-muted-foreground"
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: label.color }}
                    aria-hidden
                  />
                  {label.name}
                </span>
              ))}
            </span>
          )}
        </Link>

        {/* Hover actions take the timestamp's place (pointer screens). */}
        <span className="absolute top-2 right-2 z-10 hidden items-center gap-0.5 rounded-full bg-box opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 md:flex">
          <IconButton
            size="sm"
            icon="star"
            filled={thread.is_starred}
            label={thread.is_starred ? "Unstar" : "Star"}
            onClick={onStar}
          />
          {folder !== "trash" && (
            <IconButton size="sm" icon="archive" label="Archive" onClick={onArchive} />
          )}
          <IconButton
            size="sm"
            icon={thread.unread_count > 0 ? "mark_email_read" : "mark_email_unread"}
            label={thread.unread_count > 0 ? "Mark read" : "Mark unread"}
            onClick={onRead}
          />
          <IconButton
            size="sm"
            icon={folder === "trash" ? "delete_forever" : "delete"}
            label={folder === "trash" ? "Delete forever" : "Delete"}
            onClick={onDelete}
          />
        </span>
      </motion.div>
    </li>
  );
}
