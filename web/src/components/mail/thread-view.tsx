import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Skeleton,
  Tooltip,
} from "@/components/kit";
import { errorMessage, useImageTrust, useThread } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  attachmentUrl,
  displayName,
  formatAddress,
  formatBytes,
  formatDateTime,
  forwardSubject,
  quoteMessage,
  replySubject,
} from "@/lib/mail";
import type { Folder, Message, Thread } from "@/lib/types";
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
      <div className="space-y-4 p-6">
        <Skeleton className="h-7 w-2/3" />
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
  const [params, setParams] = useSearchParams();
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

  // ?reply=reply|replyAll|forward (from the extension and push) opens the composer once.
  // The parameter is dropped afterwards so going back or reloading does not
  // open a second composer over the first.
  const reply = params.get("reply");
  const replied = useRef(false);
  useEffect(() => {
    if (!reply || !last || replied.current) return;
    replied.current = true;
    const mode: ReplyMode = reply === "replyAll" || reply === "forward" ? reply : "reply";
    composer.open(replyDraft(thread, last, mode));
    const next = new URLSearchParams(params);
    next.delete("reply");
    setParams(next, { replace: true });
  }, [reply, last, thread, composer, params, setParams]);

  return (
    <section className="flex h-full min-w-0 flex-col">
      <ConfirmDialog
        open={purging}
        onOpenChange={setPurging}
        title="Delete this conversation forever?"
        description={thread.subject || "(no subject)"}
        consequences="It is already in Trash. This removes its messages and attachments for good."
        confirmLabel="Delete forever"
        onConfirm={() => actions.purge([thread.id])}
      />

      <header className="flex h-14 shrink-0 items-center gap-0.5 px-2">
        <Tooltip label="Back to the list">
          <IconButton
            icon="arrow_back"
            label="Back to the list"
            render={<Link to={backHref} />}
            nativeButton={false}
          />
        </Tooltip>
        {inTrash ? (
          <Action
            icon="restore_from_trash"
            label="Put back"
            onClick={() => actions.restore([thread.id])}
          />
        ) : thread.folders.includes("archive") ? (
          <Action
            icon="unarchive"
            label="Move to inbox"
            onClick={() => actions.move([thread.id], "inbox", "archive")}
          />
        ) : (
          <Action
            icon="archive"
            label="Archive"
            onClick={() => actions.move([thread.id], "archive", from)}
          />
        )}
        {!thread.folders.includes("spam") && (
          <Action
            icon="report"
            label="Report spam"
            onClick={() => actions.move([thread.id], "spam", from)}
          />
        )}
        <Action
          icon={inTrash ? "delete_forever" : "delete"}
          label={inTrash ? "Delete forever" : "Delete"}
          onClick={() => (inTrash ? setPurging(true) : actions.trash([thread.id]))}
        />
        <Separator orientation="vertical" className="mx-1 my-4" />
        <LabelMenu threadIds={[thread.id]} applied={thread.labels?.map((l) => l.id)} />
        <MoveMenu thread={thread} onMove={(to) => actions.move([thread.id], to, from)} />
        <Action
          icon="star"
          filled={thread.is_starred}
          label={thread.is_starred ? "Unstar" : "Star"}
          onClick={() => actions.setStarred([thread.id], !thread.is_starred)}
        />
        <Action
          icon="mark_email_unread"
          label="Mark unread"
          onClick={() => actions.setRead([thread.id], false)}
        />

        {last && !last.is_draft && (
          <div className="ml-auto hidden items-center gap-0.5 sm:flex">
            <Action
              icon="reply_all"
              label="Reply all"
              onClick={() => composer.open(replyDraft(thread, last, "replyAll"))}
            />
            <Action
              icon="forward"
              label="Forward"
              onClick={() => composer.open(replyDraft(thread, last, "forward"))}
            />
            <Button
              icon="reply"
              className="ml-1"
              onClick={() => composer.open(replyDraft(thread, last, "reply"))}
            >
              Reply
            </Button>
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-24 sm:px-6 md:pb-8">
        <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-[22px] leading-snug font-medium tracking-tight">
            {thread.subject || "(no subject)"}
          </h1>
          {thread.labels?.map((label) => (
            <Badge key={label.id} className="pr-1">
              <span
                className="size-2 rounded-full"
                style={{ background: label.color }}
                aria-hidden
              />
              {label.name}
            </Badge>
          ))}
        </div>

        <ol className="flex flex-col gap-3">
          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
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
            />
          ))}
        </ol>

        {last && !last.is_draft && (
          <div className="mt-6 flex flex-wrap gap-2">
            <Button icon="reply" onClick={() => composer.open(replyDraft(thread, last, "reply"))}>
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
    </section>
  );
}

function Action({
  icon,
  label,
  onClick,
  filled,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  filled?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <IconButton icon={icon} label={label} filled={filled} onClick={onClick} />
    </Tooltip>
  );
}

function MoveMenu({ thread, onMove }: { thread: Thread; onMove: (to: Folder) => void }) {
  const targets: Folder[] = (["inbox", "archive", "spam", "trash"] as const).filter(
    (f) => !thread.folders.includes(f),
  );
  return (
    <DropdownMenu>
      <Tooltip label="Move to">
        <DropdownMenuTrigger render={<IconButton icon="drive_file_move" label="Move to" />} />
      </Tooltip>
      <DropdownMenuContent>
        {targets.map((folder) => (
          <DropdownMenuItem key={folder} icon={FOLDER_ICON[folder]} onClick={() => onMove(folder)}>
            {folder[0]!.toUpperCase() + folder.slice(1)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const FOLDER_ICON: Record<string, string> = {
  inbox: "inbox",
  archive: "archive",
  spam: "report",
  trash: "delete",
};

function MessageItem({
  message,
  open,
  imagesAllowed,
  onToggle,
  onReply,
  onEditDraft,
}: {
  message: Message;
  open: boolean;
  imagesAllowed: boolean;
  onToggle: () => void;
  onReply: (mode: ReplyMode) => void;
  onEditDraft: () => void;
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

  return (
    <li className="rounded-3xl bg-box px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? "Collapse message" : "Expand message"}
          className="shrink-0 rounded-full"
        >
          <Avatar size="lg" name={message.from.name} address={message.from.address} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={onToggle}
              className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 text-left"
            >
              <span className="truncate text-sm font-semibold">{displayName(message.from)}</span>
              <span className="hidden truncate font-mono text-xs text-muted-foreground sm:inline">
                {message.from.address}
              </span>
              {message.is_draft && (
                <Badge tone="danger" size="sm">
                  Draft
                </Badge>
              )}
              {outbound && message.status && !message.is_draft && (
                <DeliveryBadge message={message} />
              )}
            </button>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatDateTime(message.sent_at ?? message.received_at)}
            </span>
            {open && !message.is_draft && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <IconButton icon="more_vert" label="More" size="sm" className="-mt-1.5" />
                  }
                />
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
                    onClick={() =>
                      window.open(`/api/app/messages/${message.id}/raw`, "_blank", "noopener")
                    }
                  >
                    Download original
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <span className="truncate">
              to {(message.to ?? []).map(displayName).join(", ") || "—"}
            </span>
            <Details message={message} />
          </div>
          {!open && (
            <button
              type="button"
              onClick={onToggle}
              className="mt-1.5 block w-full truncate text-left text-[13px] text-muted-foreground"
            >
              {message.snippet}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="mt-4">
          {!outbound && <AuthLine message={message} />}
          {outbound && message.error && (
            <p className="mb-3 rounded-2xl bg-destructive-soft px-3 py-2 text-[13px] text-destructive">
              {message.error}
            </p>
          )}
          {message.is_draft ? (
            <div className="flex items-center gap-3 rounded-2xl bg-field px-4 py-3 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {message.snippet || "Empty draft"}
              </span>
              <Button size="sm" variant="primary" icon="edit" onClick={onEditDraft}>
                Edit
              </Button>
            </div>
          ) : (
            <EmailFrame
              html={message.html}
              text={message.text}
              sender={outbound ? undefined : message.from.address.toLowerCase()}
              imagesAllowed={outbound || imagesAllowed}
              inlineImages={inline}
            />
          )}
          {files.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {files.map((file) => (
                <li key={file.id}>
                  <a
                    href={attachmentUrl(file.id)}
                    download={file.filename}
                    className="flex items-center gap-3 rounded-2xl bg-field px-3 py-2.5 transition-colors hover:bg-tonal-hover"
                  >
                    <Icon name="description" className="text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block max-w-56 truncate text-[13px] font-medium">
                        {file.filename}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatBytes(file.size_bytes)} · Download
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function DeliveryBadge({ message }: { message: Message }) {
  const bad = ["bounced", "complained", "rejected", "failed"].includes(message.status ?? "");
  return (
    <Badge
      size="sm"
      tone={bad ? "danger" : "neutral"}
      title={message.error ?? `SES: ${message.status}`}
    >
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
      <span className="truncate">· {detail}</span>
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
