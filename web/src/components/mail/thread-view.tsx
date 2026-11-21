import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Tooltip,
} from "@/components/kit";
import { errorMessage, useDeleteDraft, useImageTrust, useThread } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  attachmentUrl,
  displayName,
  FOLDER_META,
  formatAddress,
  formatBytes,
  formatDateTime,
  formatWhen,
  forwardSubject,
  quoteMessage,
  replySubject,
} from "@/lib/mail";
import type { Message, Thread } from "@/lib/types";
import { type ComposerDraft, useComposer } from "./composer-provider";
import { EmailFrame } from "./email-frame";
import { LabelMenu } from "./label-menu";
import { movableFolder, useThreadActions } from "./use-thread-actions";

type ReplyMode = "reply" | "replyAll" | "forward";

/** The draft a reply, reply-all or forward of `message` starts as. */
export function replyDraft(thread: Thread, message: Message, mode: ReplyMode): ComposerDraft {
  const own = message.mailbox.toLowerCase();
  const outbound = message.direction === "outbound";
  const replyTo = message.reply_to ? { name: null, address: message.reply_to } : message.from;
  const to = mode === "forward" ? [] : outbound ? (message.to ?? []) : [replyTo];
  const cc =
    mode === "replyAll"
      ? [...(outbound ? [] : (message.to ?? [])), ...(message.cc ?? [])].filter(
          (a) => a.address.toLowerCase() !== own && !to.some((t) => t.address === a.address),
        )
      : [];
  const refs = [...(message.references ?? []), message.message_id].filter((r): r is string =>
    Boolean(r),
  );
  return {
    title: mode === "forward" ? "Forward" : mode === "replyAll" ? "Reply all" : "Reply",
    mailboxId: thread.mailbox_id,
    to,
    cc,
    subject: mode === "forward" ? forwardSubject(thread.subject) : replySubject(thread.subject),
    html: quoteMessage(message, mode === "forward" ? "forward" : "reply"),
    threadId: mode === "forward" ? undefined : thread.id,
    inReplyTo: mode === "forward" ? undefined : (message.message_id ?? undefined),
    references: mode === "forward" ? undefined : refs,
    attachments: mode === "forward" ? message.attachments?.filter((a) => !a.is_inline) : undefined,
  };
}

/** A saved draft, reopened in the composer. */
function draftOf(thread: Thread, message: Message): ComposerDraft {
  return {
    title: "Draft",
    draftId: message.id,
    mailboxId: message.mailbox_id,
    to: message.to ?? [],
    cc: message.cc ?? [],
    bcc: message.bcc ?? [],
    subject: message.subject,
    html: message.html ?? message.text ?? "",
    threadId: thread.message_count > 1 ? thread.id : undefined,
    inReplyTo: message.in_reply_to ?? undefined,
    references: message.references ?? undefined,
    attachments: message.attachments,
  };
}

export function ThreadView({
  threadId,
  backHref,
  folder,
}: {
  threadId: string;
  backHref: string;
  folder: string;
}) {
  const query = useThread(threadId);
  const thread = query.data;

  if (query.isPending) {
    return (
      <div className="mx-auto w-full max-w-165 space-y-5 px-8 pt-9.5">
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.isError || !thread) {
    return (
      <EmptyState
        icon="error"
        title="Could not open this conversation"
        body={errorMessage(query.error)}
        action={
          <Button render={<Link to={backHref} />} nativeButton={false}>
            Back to the list
          </Button>
        }
      />
    );
  }
  return <Conversation key={thread.id} thread={thread} backHref={backHref} folder={folder} />;
}

function Conversation({
  thread,
  backHref,
  folder,
}: {
  thread: Thread;
  backHref: string;
  folder: string;
}) {
  const actions = useThreadActions();
  const composer = useComposer();
  const discardDraft = useDeleteDraft();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [purging, setPurging] = useState(false);
  const messages = thread.messages ?? [];
  const last = messages.findLast((m) => !m.is_draft) ?? messages.at(-1);
  const inTrash = thread.folders.every((f) => f === "trash");
  const from = movableFolder(folder);

  // Open: the last message, unread ones, and every one of a short thread.
  const [open, setOpen] = useState<Set<string>>(
    () =>
      new Set(
        messages
          .filter((m, i) => messages.length <= 3 || !m.is_read || i === messages.length - 1)
          .map((m) => m.id),
      ),
  );

  const senders = useMemo(
    () => [
      ...new Set(
        messages.filter((m) => m.direction === "inbound").map((m) => m.from.address.toLowerCase()),
      ),
    ],
    [messages],
  );
  const trust = useImageTrust(senders);

  // Reading it marks it read, once.
  const marked = useRef(false);
  useEffect(() => {
    if (!marked.current && thread.unread_count > 0) {
      marked.current = true;
      actions.setRead([thread.id], true);
    }
  }, [thread.id, thread.unread_count, actions]);

  // ?reply=reply|replyAll|forward (from the list, the extension and push)
  // opens the composer once. The parameter is dropped afterwards so going
  // back or reloading does not open a second composer over the first.
  const reply = params.get("reply");
  const replied = useRef(false);
  useEffect(() => {
    if (!reply) {
      replied.current = false;
      return;
    }
    if (!last || replied.current) return;
    replied.current = true;
    const mode: ReplyMode = reply === "replyAll" || reply === "forward" ? reply : "reply";
    composer.open(replyDraft(thread, last, mode));
    const next = new URLSearchParams(params);
    next.delete("reply");
    setParams(next, { replace: true });
  }, [reply, last, thread, composer, params, setParams]);

  const archived = thread.folders.includes("archive");

  return (
    <section className="flex h-full min-w-0 flex-col">
      <ConfirmDialog
        open={purging}
        onOpenChange={setPurging}
        title="Delete this conversation forever?"
        description={thread.subject || "(no subject)"}
        consequences="It is already in Trash. This removes its messages and attachments for good."
        confirmLabel="Delete forever"
        onConfirm={async () => {
          await actions.purge([thread.id]);
          // It is gone: staying would refetch it and show an error.
          navigate(backHref);
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3 pb-24 sm:px-8 md:pb-10 lg:pt-9.5">
        <div className="mx-auto w-full max-w-165">
          {/* Where you are on the left (folder, mailbox, labels), actions on the right. */}
          <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-2 border-b border-border pb-3">
            <Tooltip label="Back to the list">
              <IconButton
                icon="arrow_back"
                label="Back to the list"
                size="sm"
                className="-ml-2"
                render={<Link to={backHref} />}
                nativeButton={false}
              />
            </Tooltip>
            <nav
              aria-label="Location"
              className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground"
            >
              <Link
                to={backHref}
                className="rounded font-medium text-soft-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                {FOLDER_META[folder as keyof typeof FOLDER_META]?.label ?? folder}
              </Link>
              <Icon name="chevron_right" size={16} />
              <span
                className="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-tonal px-2 py-0.5 font-mono text-xs text-soft-foreground"
                title={thread.mailbox}
              >
                <span
                  aria-hidden
                  className="size-1.75 shrink-0 rounded-[2px]"
                  style={{ background: thread.mailbox_color }}
                />
                <span className="truncate">{thread.mailbox}</span>
              </span>
            </nav>
            {thread.labels?.map((label) => (
              <Badge key={label.id} tone="accent">
                {label.name}
              </Badge>
            ))}
            <span className="flex-1" />
            {inTrash ? (
              <Tooltip label="Put back">
                <IconButton
                  icon="restore_from_trash"
                  label="Put back"
                  size="sm"
                  onClick={() => actions.restore([thread.id])}
                />
              </Tooltip>
            ) : archived ? (
              <Tooltip label="Move to Inbox">
                <IconButton
                  icon="unarchive"
                  label="Move to Inbox"
                  size="sm"
                  onClick={() => actions.move([thread.id], "inbox", "archive")}
                />
              </Tooltip>
            ) : (
              <Tooltip label="Archive">
                <IconButton
                  icon="archive"
                  label="Archive"
                  size="sm"
                  onClick={() => actions.move([thread.id], "archive", from)}
                />
              </Tooltip>
            )}
            <LabelMenu
              threadIds={[thread.id]}
              applied={thread.labels?.map((l) => l.id)}
              trigger={<IconButton icon="label" label="Label" size="sm" />}
            />
            <Tooltip label={thread.is_starred ? "Unstar" : "Star"}>
              <IconButton
                icon="star"
                size="sm"
                filled={thread.is_starred}
                className={cn(thread.is_starred && "text-accent")}
                label={thread.is_starred ? "Unstar" : "Star"}
                onClick={() => actions.setStarred([thread.id], !thread.is_starred)}
              />
            </Tooltip>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<IconButton icon="more_horiz" label="More actions" size="sm" />}
              />
              <DropdownMenuContent>
                <DropdownMenuItem
                  icon="mark_email_unread"
                  onClick={() => actions.setRead([thread.id], false)}
                >
                  Mark unread
                </DropdownMenuItem>
                {(["inbox", "archive", "spam"] as const)
                  .filter((f) => !thread.folders.includes(f))
                  .map((f) => (
                    <DropdownMenuItem
                      key={f}
                      icon={FOLDER_ICON[f]}
                      onClick={() => actions.move([thread.id], f, from)}
                    >
                      {f === "spam" ? "Report spam" : `Move to ${f}`}
                    </DropdownMenuItem>
                  ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  icon={inTrash ? "delete_forever" : "delete"}
                  destructive
                  onClick={() => (inTrash ? setPurging(true) : actions.trash([thread.id]))}
                >
                  {inTrash ? "Delete forever" : "Delete"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <h1 className="mt-5 text-[26px] leading-[1.15] font-semibold tracking-[-0.025em] break-words sm:text-[32px]">
            {thread.subject || "(no subject)"}
          </h1>

          <ol className="mt-5.5 flex flex-col gap-6">
            {messages.map((message, index) => (
              <MessageItem
                key={message.id}
                message={message}
                first={index === 0}
                open={open.has(message.id)}
                imagesAllowed={trust.data?.[message.from.address.toLowerCase()] ?? false}
                onToggle={() =>
                  setOpen((current) => {
                    const next = new Set(current);
                    if (next.has(message.id)) next.delete(message.id);
                    else next.add(message.id);
                    return next;
                  })
                }
                onReply={(mode) => composer.open(replyDraft(thread, message, mode))}
                onEditDraft={() => composer.open(draftOf(thread, message))}
                onDiscardDraft={() => discardDraft.mutate(message.id)}
              />
            ))}
          </ol>

          {last && !last.is_draft && (
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                variant="primary"
                icon="reply"
                onClick={() => composer.open(replyDraft(thread, last, "reply"))}
              >
                Reply
              </Button>
              <Button
                icon="reply_all"
                onClick={() => composer.open(replyDraft(thread, last, "replyAll"))}
              >
                Reply all
              </Button>
              <Button
                icon="forward"
                onClick={() => composer.open(replyDraft(thread, last, "forward"))}
              >
                Forward
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const FOLDER_ICON: Record<string, string> = {
  inbox: "move_to_inbox",
  archive: "archive",
  spam: "report",
  trash: "delete",
};

/**
 * One message. Received mail reads as a letter (sender row, then the body);
 * the owner's own messages sit in a "YOUR REPLY" box.
 */
function MessageItem({
  message,
  first,
  open,
  imagesAllowed,
  onToggle,
  onReply,
  onEditDraft,
  onDiscardDraft,
}: {
  message: Message;
  first: boolean;
  open: boolean;
  imagesAllowed: boolean;
  onToggle: () => void;
  onReply: (mode: ReplyMode) => void;
  onEditDraft: () => void;
  onDiscardDraft: () => void;
}) {
  const inline = useMemo(
    () =>
      Object.fromEntries(
        (message.attachments ?? [])
          .filter((a) => a.is_inline && a.content_id)
          .map((a) => [a.content_id!.replace(/^<|>$/g, ""), attachmentUrl(a.id, true)]),
      ),
    [message.attachments],
  );
  const files = (message.attachments ?? []).filter((a) => !a.is_inline);
  const outbound = message.direction === "outbound";
  const when = formatWhen(message.sent_at ?? message.received_at);

  const menu = open && (
    <DropdownMenu>
      <DropdownMenuTrigger render={<IconButton icon="more_vert" label="More" size="xs" />} />
      <DropdownMenuContent>
        <DropdownMenuItem icon="reply" onClick={() => onReply("reply")}>
          Reply
        </DropdownMenuItem>
        <DropdownMenuItem icon="reply_all" onClick={() => onReply("replyAll")}>
          Reply all
        </DropdownMenuItem>
        <DropdownMenuItem icon="forward" onClick={() => onReply("forward")}>
          Forward
        </DropdownMenuItem>
        <DropdownMenuItem
          icon="code"
          onClick={() => window.open(`/api/app/messages/${message.id}/raw`, "_blank", "noopener")}
        >
          Download original
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const body = open && (
    <div className="mt-4">
      {!outbound && <AuthLine message={message} />}
      {outbound && message.error && (
        <p className="mb-3 rounded-lg bg-destructive-soft px-3 py-2 text-[13px] text-destructive">
          {message.error}
        </p>
      )}
      <EmailFrame
        html={message.html}
        text={message.text}
        sender={outbound ? undefined : message.from.address.toLowerCase()}
        imagesAllowed={outbound || imagesAllowed}
        inlineImages={inline}
      />
      {files.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {files.map((file) => (
            <li key={file.id}>
              <a
                href={attachmentUrl(file.id)}
                download={file.filename}
                className="flex items-center gap-3 rounded-[10px] border border-border bg-surface px-3 py-2.5 transition-colors hover:bg-tonal"
              >
                <Icon name="description" className="text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block max-w-56 truncate text-[13px] font-medium">
                    {file.filename}
                  </span>
                  <span className="block font-mono text-[11px] text-muted-foreground">
                    {formatBytes(file.size_bytes)}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  // A draft always shows its Edit button: it is never collapsed behind a
  // toggle, so an unsent reply can be picked up again in one click.
  if (message.is_draft) {
    return (
      <li className="rounded-[14px] border border-dashed border-accent/50 bg-surface px-4.5 py-4">
        <div className="flex items-center gap-2">
          <span className="flex-1 font-display text-xs font-semibold tracking-[0.04em] text-accent uppercase">
            Draft · {when}
          </span>
          <Button size="sm" variant="ghost" icon="delete" onClick={onDiscardDraft}>
            Discard
          </Button>
          <Button size="sm" variant="primary" icon="edit" onClick={onEditDraft}>
            Edit
          </Button>
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          to {(message.to ?? []).map(displayName).join(", ") || "—"}
        </p>
        <button
          type="button"
          onClick={onEditDraft}
          className="mt-1.5 block w-full truncate text-left text-soft-foreground"
        >
          {message.snippet || "Empty draft"}
        </button>
      </li>
    );
  }

  if (outbound) {
    return (
      <li className="rounded-[14px] border border-border bg-surface px-4.5 py-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-left"
          >
            <span className="font-display text-xs font-semibold tracking-[0.04em] text-accent uppercase">
              {first ? "You wrote" : "Your reply"} · {when}
            </span>
            {message.status && <DeliveryBadge message={message} />}
          </button>
          <Details message={message} />
          {menu}
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          to {(message.to ?? []).map(displayName).join(", ") || "—"}
        </p>
        {open ? (
          <div className="text-soft-foreground">{body}</div>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            className="mt-1.5 block w-full truncate text-left text-soft-foreground"
          >
            {message.snippet}
          </button>
        )}
      </li>
    );
  }

  return (
    <li>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? "Collapse message" : "Expand message"}
          className="shrink-0 rounded-full"
        >
          <Avatar size="lg" name={message.from.name} address={message.from.address} />
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="block max-w-full truncate text-left font-semibold"
          >
            {displayName(message.from)}
          </button>
          <div className="flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground">
            <span className="truncate">
              {message.from.address} · {when}
            </span>
            <Details message={message} />
          </div>
        </div>
        {menu}
      </div>
      {open ? (
        body
      ) : (
        <button
          type="button"
          onClick={onToggle}
          className="mt-2 block w-full truncate text-left text-[13px] text-muted-foreground"
        >
          {message.snippet}
        </button>
      )}
    </li>
  );
}

function DeliveryBadge({ message }: { message: Message }) {
  const bad = ["bounced", "complained", "rejected", "failed"].includes(message.status ?? "");
  return (
    <Badge size="sm" tone={bad ? "danger" : "neutral"} title={message.error ?? undefined}>
      {message.opened_at
        ? `opened${message.open_count > 1 ? ` ${message.open_count}×` : ""}`
        : message.status}
    </Badge>
  );
}

/** Sender checks: one quiet line when they pass, a warning when one fails. */
function AuthLine({ message }: { message: Message }) {
  const checks = (
    [
      ["SPF", message.spf],
      ["DKIM", message.dkim],
      ["DMARC", message.dmarc],
    ] as const
  ).filter(([, v]) => v);
  if (checks.length === 0) return null;
  const failed = checks.filter(([, v]) => !["pass", "none", "neutral"].includes(v!));
  const detail = checks.map(([n, v]) => `${n} ${v}`).join(" · ");
  return (
    <p
      title={detail}
      className={cn(
        "mb-3 flex items-center gap-1.5 text-xs",
        failed.length ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <Icon name={failed.length ? "gpp_maybe" : "verified_user"} size={16} />
      <span className="font-medium">
        {failed.length ? `${failed.map(([n]) => n).join(", ")} did not pass` : "Sender verified"}
      </span>
      {failed.length > 0 && <span className="truncate">· {detail}</span>}
    </p>
  );
}

/** The full header, as mail clients have always offered it. */
function Details({ message }: { message: Message }) {
  const list = (a: Message["to"]) => (a ?? []).map(formatAddress).join(", ");
  const rows: [string, ReactNode][] = [
    ["from", formatAddress(message.from)],
    ["to", list(message.to)],
    ...(message.cc?.length ? [["cc", list(message.cc)] as [string, ReactNode]] : []),
    ...(message.bcc?.length ? [["bcc", list(message.bcc)] as [string, ReactNode]] : []),
    ...(message.reply_to ? [["reply-to", message.reply_to] as [string, ReactNode]] : []),
    ["date", formatDateTime(message.sent_at ?? message.received_at)],
    ["mailbox", message.mailbox],
    ...(message.mailed_by ? [["mailed-by", message.mailed_by] as [string, ReactNode]] : []),
    ...(message.signed_by ? [["signed by", message.signed_by] as [string, ReactNode]] : []),
    ...(message.tls
      ? [
          ["security", message.tls === "none" ? "No encryption" : `TLS (${message.tls})`] as [
            string,
            ReactNode,
          ],
        ]
      : []),
    ...(message.message_id ? [["message id", message.message_id] as [string, ReactNode]] : []),
    ...(message.size_bytes
      ? [["size", formatBytes(message.size_bytes)] as [string, ReactNode]]
      : []),
  ];
  return (
    <Popover>
      <PopoverTrigger
        render={
          <IconButton icon="expand_more" label="Message details" size="sm" className="size-6" />
        }
      />
      <PopoverContent align="start" className="w-[min(32rem,calc(100vw-2rem))]">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
          {rows.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-right text-muted-foreground">{label}:</dt>
              <dd className="min-w-0 font-mono text-xs leading-5 break-words">{value}</dd>
            </Fragment>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
