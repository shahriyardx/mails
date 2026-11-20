import { type ThreadPatch, replyUrl, threadUrl } from "@/lib/api";
import { cx, displayName, formatBytes, fullTime, shortTime } from "@/lib/format";
import { openTab } from "@/lib/hooks";
import { prepareEmail, textToHtml } from "@/lib/sanitize";
import type { Settings } from "@/lib/settings";
import type { Theme } from "@/lib/theme";
import { type ApiMessage, type ApiThread, VIEW_FOLDER, type View } from "@/lib/types";
import { useMemo, useState } from "react";
import { EmailFrame } from "./email-frame";
import { Avatar, Button, EmptyState, Icon, IconButton, LabelChip, Spinner } from "./kit";

/**
 * A conversation, read.
 *
 * Reading, triage and deleting happen here. Writing does not: composing in a
 * 400-pixel popup with no drafts, no attachments and no signature would be a
 * worse version of something that already exists one click away, so every
 * reply hands over to the dashboard with the box already open.
 *
 * Shaped like the web reading pane: received mail reads as a letter, the
 * owner's own messages sit in a "YOUR REPLY" panel.
 */

interface Props {
  thread: ApiThread | null;
  loading: boolean;
  error: string | null;
  view: View;
  settings: Settings;
  theme: Theme;
  onBack: () => void;
  onPatch: (patch: ThreadPatch) => void;
  onTrash: () => void;
  /** Whether the back arrow is worth drawing; in two panes it is not. */
  showBack: boolean;
  /**
   * Whether there is a whole window to fill rather than 400 pixels. Caps and
   * centres the column, since body copy across a monitor is unreadable.
   */
  roomy?: boolean;
}

export function ThreadView({
  thread,
  loading,
  error,
  view,
  settings,
  theme,
  onBack,
  onPatch,
  onTrash,
  showBack,
  roomy = false,
}: Props) {
  const folder = VIEW_FOLDER[view];
  /** The column everything in here lines up to. */
  const column = roomy ? "mx-auto w-full max-w-[700px]" : "w-full";

  if (loading && !thread) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon="error"
        title="That conversation would not open"
        body={error}
        action={
          showBack ? (
            <Button variant="outline" icon="arrow_back" onClick={onBack}>
              Back
            </Button>
          ) : null
        }
      />
    );
  }

  if (!thread) {
    return (
      <EmptyState
        icon="mail"
        title="Nothing open"
        body="Pick a conversation on the left and it will be read here."
      />
    );
  }

  const messages = thread.messages ?? [];
  const unread = thread.unread_count > 0;
  const inApp = () => openTab(threadUrl(settings, thread, folder));
  const reply = (mode: "reply" | "replyAll" | "forward") =>
    openTab(replyUrl(settings, thread, folder, mode));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* toolbar */}
      <div className="shrink-0 border-b border-border px-2 py-1.5">
        <div className={cx("flex items-center gap-0.5", column, roomy && "px-4")}>
          {showBack ? <IconButton icon="arrow_back" label="Back" onClick={onBack} /> : null}

          <div className="ml-auto flex items-center gap-0.5">
            <IconButton
              icon="archive"
              label="Archive"
              onClick={() => onPatch({ folder: "archive" })}
            />
            <IconButton
              icon="star"
              filled={thread.is_starred}
              label={thread.is_starred ? "Remove star" : "Star"}
              className={thread.is_starred ? "text-accent" : undefined}
              onClick={() => onPatch({ is_starred: !thread.is_starred })}
            />
            <IconButton
              icon={unread ? "mark_email_read" : "mark_email_unread"}
              label={unread ? "Mark as read" : "Mark as unread"}
              onClick={() => onPatch({ is_read: unread })}
            />
            <IconButton
              icon="report"
              label="Mark as spam"
              onClick={() => onPatch({ folder: "spam" })}
            />
            <IconButton icon="delete" label="Delete" tone="danger" onClick={onTrash} />
            <IconButton icon="open_in_new" label="Open in Mails" onClick={inApp} />
          </div>
        </div>
      </div>

      {/* the conversation */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cx("px-4 pt-4 pb-6", column, roomy && "px-6 pt-8")}>
          {(thread.labels ?? []).length > 0 ? (
            <div className="mb-2.5 flex flex-wrap gap-1">
              {(thread.labels ?? []).map((label) => (
                <LabelChip key={label.id} name={label.name} color={label.color} />
              ))}
            </div>
          ) : null}

          <h1
            className={cx(
              "font-semibold leading-tight text-foreground",
              roomy ? "text-[28px]" : "text-[19px]",
            )}
          >
            {thread.subject?.trim() || "(no subject)"}
          </h1>

          {thread.mailbox ? (
            <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[11.5px] text-muted-foreground">
              {thread.mailbox_color ? (
                <span
                  aria-hidden
                  className="size-2 rounded-[2px]"
                  style={{ background: thread.mailbox_color }}
                />
              ) : null}
              {thread.mailbox}
            </div>
          ) : null}

          <ol className="mt-5 space-y-5">
            {messages.map((message, index) => (
              <MessageItem
                key={message.id}
                message={message}
                first={index === 0}
                theme={theme}
                defaultOpen={index === messages.length - 1}
                onOpenInApp={inApp}
              />
            ))}
          </ol>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="primary" icon="reply" onClick={() => reply("reply")}>
              Reply
            </Button>
            <Button icon="reply_all" onClick={() => reply("replyAll")}>
              Reply all
            </Button>
            <Button icon="forward" onClick={() => reply("forward")}>
              Forward
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- one message */

function MessageItem({
  message,
  first,
  theme,
  defaultOpen,
  onOpenInApp,
}: {
  message: ApiMessage;
  first: boolean;
  theme: Theme;
  defaultOpen: boolean;
  /** Downloading a file needs the key in a header, which a link cannot carry,
   *  so an attachment hands the reader to the dashboard instead. */
  onOpenInApp: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showImages, setShowImages] = useState(false);
  const outbound = message.direction === "outbound";

  const prepared = useMemo(() => {
    if (message.html?.trim()) return prepareEmail(message.html, { showRemoteImages: showImages });
    if (message.text?.trim()) {
      return { html: textToHtml(message.text), blockedImages: 0 };
    }
    return { html: "", blockedImages: 0 };
  }, [message.html, message.text, showImages]);

  const attachments = (message.attachments ?? []).filter((file) => !file.is_inline);
  const when = message.sent_at ?? message.received_at;
  const toggle = () => setOpen(!open);

  const snippet = (
    <button
      type="button"
      onClick={toggle}
      className="mt-1.5 block w-full truncate text-left text-[13px] text-muted-foreground"
    >
      {message.snippet || "No preview"}
    </button>
  );

  const body = (
    <div className="mt-3">
      {!outbound ? (
        <div className="mb-2 truncate text-xs text-muted-foreground">
          to {message.to.map((entry) => displayName(entry)).join(", ") || "undisclosed"}
        </div>
      ) : null}
      {message.cc.length > 0 ? (
        <div className="mb-2 truncate font-mono text-[11px] text-muted-foreground">
          cc {message.cc.map((entry) => entry.address).join(", ")}
        </div>
      ) : null}

      {prepared.blockedImages > 0 ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-tonal px-3 py-2 text-xs text-soft-foreground">
          <Icon name="hide_image" size={16} />
          <span className="flex-1">
            {prepared.blockedImages} remote{" "}
            {prepared.blockedImages === 1 ? "image is" : "images are"} not loaded
          </span>
          <button
            type="button"
            onClick={() => setShowImages(true)}
            className="rounded font-semibold text-accent hover:underline"
          >
            Show
          </button>
        </div>
      ) : null}

      {prepared.html ? (
        <EmailFrame html={prepared.html} allowRemote={showImages} theme={theme} />
      ) : (
        <div className="text-[13px] italic text-muted-foreground">This message has no body.</div>
      )}

      {attachments.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {attachments.map((file) => (
            <button
              key={file.id}
              type="button"
              onClick={onOpenInApp}
              title={`${file.filename}: open in Mails to download`}
              className="flex max-w-full items-center gap-2.5 rounded-[10px] border border-border bg-surface px-2.5 py-2 text-left transition-colors hover:bg-tonal"
            >
              <Icon name="description" className="text-muted-foreground" />
              <span className="min-w-0">
                <span className="block max-w-48 truncate text-[12.5px] font-medium">
                  {file.filename}
                </span>
                <span className="block font-mono text-[10.5px] text-muted-foreground">
                  {file.size_bytes ? `${formatBytes(file.size_bytes)} · ` : ""}open in Mails
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  if (outbound) {
    return (
      <li
        className={cx(
          "rounded-[14px] border bg-surface px-4 py-3.5",
          message.is_draft ? "border-dashed border-accent/50" : "border-border",
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          title={fullTime(when)}
          className="block max-w-full truncate text-left font-display text-[11.5px] font-semibold uppercase tracking-[0.04em] text-accent"
        >
          {message.is_draft ? "Draft, not sent" : first ? "You wrote" : "Your reply"} ·{" "}
          <span className="font-mono font-medium normal-case tracking-normal">
            {shortTime(when)}
          </span>
        </button>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          to {message.to.map((entry) => displayName(entry)).join(", ") || "undisclosed"}
        </p>
        {open ? body : snippet}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 text-left"
      >
        <Avatar name={message.from.name} address={message.from.address} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">
            {displayName(message.from)}
          </span>
          <span
            title={fullTime(when)}
            className="block truncate font-mono text-[11px] text-muted-foreground"
          >
            {message.from.address} · {shortTime(when)}
          </span>
        </span>
        <Icon
          name="expand_more"
          className={cx("text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open ? body : snippet}
    </li>
  );
}
