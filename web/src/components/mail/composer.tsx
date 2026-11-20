import DOMPurify from "dompurify";
import { motion } from "motion/react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Icon,
  IconButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  Tooltip,
  toast,
} from "@/components/kit";
import { spatial } from "@/components/kit/motion";
import {
  errorMessage,
  saveDraft,
  uploadFile,
  useDeleteDraft,
  useMailboxes,
  useSend,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { useIsPhone } from "@/lib/hooks";
import { formatAddress, formatBytes } from "@/lib/mail";
import { restoreBlockedImages, sanitizeForEditor } from "@/lib/sanitize";
import type { Address, Mailbox, OutgoingMail } from "@/lib/types";
import type { ComposerDraft } from "./composer-provider";
import { RecipientInput } from "./recipient-input";
import { RichEditor } from "./rich-editor";

interface FileChip {
  /** Attachment id once stored; a temporary key while uploading. */
  id: string;
  filename: string;
  size_bytes: number;
  uploading?: boolean;
  /** Forwarded from another message: sent, but not kept on the draft. */
  forwarded?: boolean;
}

const AUTOSAVE_MS = 2500;

/** A signature as HTML: kept when it is HTML, line breaks kept when it is text. */
function signatureHtml(signature: string | null | undefined) {
  if (!signature?.trim()) return "";
  const html = /<[a-z][\s\S]*>/i.test(signature)
    ? signature
    : signature.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
  return DOMPurify.sanitize(html);
}

function pickMailbox(mailboxes: Mailbox[], wanted?: string) {
  return (
    mailboxes.find((m) => m.id === wanted) ?? mailboxes.find((m) => m.is_default) ?? mailboxes[0]
  );
}

export default function Composer({
  draft,
  onClose,
}: {
  draft: ComposerDraft;
  onClose: () => void;
}) {
  const phone = useIsPhone();
  const mailboxes = useMailboxes();
  const send = useSend();
  const deleteDraft = useDeleteDraft();
  const fileInput = useRef<HTMLInputElement>(null);

  const initialHtml = useMemo(() => sanitizeForEditor(draft.html ?? ""), [draft.html]);
  const [mailboxId, setMailboxId] = useState(draft.mailboxId ?? "");
  const [to, setTo] = useState<Address[]>(draft.to ?? []);
  const [cc, setCc] = useState<Address[]>(draft.cc ?? []);
  const [bcc, setBcc] = useState<Address[]>(draft.bcc ?? []);
  const [showCc, setShowCc] = useState(Boolean(draft.cc?.length || draft.bcc?.length));
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [html, setHtml] = useState(initialHtml);
  const [files, setFiles] = useState<FileChip[]>(
    () => draft.attachments?.map((a) => ({ ...a, forwarded: !draft.draftId })) ?? [],
  );
  const [expanded, setExpanded] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The latest recipients, set as they change. Ctrl+Enter in a recipient
  // field turns the typed address into a chip and sends in the same event,
  // before a re-render could hand submit() the new state.
  const recipients = useRef({ to, cc, bcc });
  const draftId = useRef(draft.draftId);
  const dirty = useRef(false);
  const saving = useRef<Promise<unknown> | null>(null);

  const mailbox = pickMailbox(mailboxes.data ?? [], mailboxId || draft.mailboxId);
  const mailboxItems = useMemo(
    () => Object.fromEntries((mailboxes.data ?? []).map((m) => [m.id, m.address])),
    [mailboxes.data],
  );
  const signature = signatureHtml(mailbox?.signature);
  const uploading = files.some((f) => f.uploading);

  function message(forSend: boolean): OutgoingMail | null {
    if (!mailbox) return null;
    const list = (entries: Address[]) => entries.map(formatAddress);
    const { to, cc, bcc } = recipients.current;
    const body = forSend
      ? restoreBlockedImages(html) + (signature ? `<br><br>${signature}` : "")
      : html;
    return {
      from: mailbox.address,
      to: list(to),
      cc: list(cc),
      bcc: list(bcc),
      subject,
      html: body,
      attachment_ids: files
        .filter((f) => !f.uploading && (forSend || !f.forwarded))
        .map((f) => f.id),
      thread_id: draft.threadId,
      in_reply_to: draft.inReplyTo,
      references: draft.references,
      draft_id: draftId.current,
    };
  }

  /** Saves the draft; resolves false (with the reason toasted) when it could not. */
  async function save(): Promise<boolean> {
    // One save at a time: a second save started before the first returns
    // would not know the draft id yet and create a duplicate draft.
    await saving.current;
    const mail = message(false);
    if (!mail || !dirty.current) return true;
    dirty.current = false;
    mail.draft_id = draftId.current;
    const run = saveDraft(mail)
      .then((res) => {
        draftId.current = res.id;
        setSaveError(null);
        setSavedAt(
          new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
        );
        return true;
      })
      .catch((error) => {
        dirty.current = true; // try again on the next change
        setSaveError(errorMessage(error));
        return false;
      });
    saving.current = run;
    return run;
  }

  // Autosave a little after typing stops.
  // biome-ignore lint/correctness/useExhaustiveDependencies: save reads the latest state
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(save, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [to, cc, bcc, subject, html, mailboxId, files]);

  const touch =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      dirty.current = true;
      set(value);
    };
  const touchRecipients = (field: "to" | "cc" | "bcc", set: (value: Address[]) => void) =>
    touch((value: Address[]) => {
      recipients.current = { ...recipients.current, [field]: value };
      set(value);
    });

  async function close() {
    const hasContent =
      recipients.current.to.length > 0 || subject.trim() || html.replace(/<[^>]*>/g, "").trim();
    if (dirty.current && hasContent) {
      if (!(await save())) {
        toast.error("Draft not saved. Copy your text, or fix the problem and close again.");
        return;
      }
      toast("Draft saved");
    }
    onClose();
  }

  async function discard() {
    dirty.current = false;
    await saving.current;
    if (draftId.current) deleteDraft.mutate(draftId.current);
    onClose();
  }

  async function submit() {
    if (send.isPending || uploading) return;
    const mail = message(true);
    if (!mail) return toast.error("Add a mailbox to send from first.");
    if (!mail.to?.length) return toast.error("Add at least one recipient.");
    dirty.current = false;
    await saving.current;
    mail.draft_id = draftId.current;
    send.mutate(mail, {
      onSuccess: (res) => {
        toast.success(res.status === "queued" ? "Queued. It keeps trying until it sends." : "Sent");
        onClose();
      },
      onError: (error) => {
        dirty.current = true; // not sent: Close saves it again
        toast.error(errorMessage(error));
      },
    });
  }

  async function attach(list: FileList | null) {
    if (!list?.length) return;
    const picked = Array.from(list);
    if (fileInput.current) fileInput.current.value = "";
    await Promise.all(
      picked.map(async (file) => {
        const temp = `upload-${crypto.randomUUID()}`;
        setFiles((current) => [
          ...current,
          { id: temp, filename: file.name, size_bytes: file.size, uploading: true },
        ]);
        try {
          const stored = await uploadFile(file);
          dirty.current = true;
          setFiles((current) => current.map((f) => (f.id === temp ? { ...stored } : f)));
        } catch (error) {
          setFiles((current) => current.filter((f) => f.id !== temp));
          toast.error(`${file.name}: ${errorMessage(error)}`);
        }
      }),
    );
  }

  function onKeyDown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape" && !event.defaultPrevented) {
      void close();
    }
  }

  const full = phone || expanded;

  return (
    <motion.section
      role="dialog"
      aria-label={draft.title ?? "New message"}
      initial={{ opacity: 0, y: 48 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 48 }}
      transition={spatial}
      onKeyDown={onKeyDown}
      className={cn(
        "fixed z-40 flex flex-col overflow-hidden border border-border bg-surface-high shadow-[0_24px_64px_var(--shadow)]",
        full
          ? phone
            ? "inset-0"
            : "inset-6 mx-auto max-w-4xl rounded-2xl"
          : "right-6 bottom-0 h-[min(36rem,calc(100dvh-3rem))] w-[min(40rem,calc(100vw-3rem))] rounded-t-2xl border-b-0",
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-1 pr-2 pl-5">
        <h2 className="flex-1 truncate text-[15px] font-semibold">
          {draft.title ?? "New message"}
        </h2>
        {saveError ? (
          <span className="mr-1 truncate text-xs text-destructive" title={saveError}>
            Not saved: {saveError}
          </span>
        ) : (
          savedAt && (
            <span className="mr-1 font-mono text-xs text-muted-foreground">saved {savedAt}</span>
          )
        )}
        {!phone && (
          <IconButton
            icon={expanded ? "close_fullscreen" : "open_in_full"}
            label={expanded ? "Shrink" : "Expand"}
            size="sm"
            onClick={() => setExpanded((v) => !v)}
          />
        )}
        <IconButton icon="close" label="Close (saves a draft)" size="sm" onClick={close} />
      </header>

      <div className="shrink-0 divide-y divide-border border-y border-border">
        <Row label="From">
          {mailboxes.data && mailboxes.data.length > 0 ? (
            <Select
              value={mailbox?.id ?? null}
              onValueChange={(value) => value && touch(setMailboxId)(value as string)}
              items={mailboxItems}
            >
              <SelectTrigger
                variant="bare"
                className="flex-1 pr-3 font-mono text-[13px]"
                aria-label="From"
              />
              <SelectContent>
                {mailboxes.data.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="font-mono">
                    {m.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-[13px] text-muted-foreground">
              {mailboxes.isPending ? "Loading…" : "No mailbox yet. Add one in Settings."}
            </span>
          )}
        </Row>
        <Row
          label="To"
          action={
            !showCc && (
              <button
                type="button"
                className="shrink-0 px-4 text-[13px] text-muted-foreground hover:text-foreground"
                onClick={() => setShowCc(true)}
              >
                Cc Bcc
              </button>
            )
          }
        >
          <RecipientInput
            value={to}
            onChange={touchRecipients("to", setTo)}
            label="To"
            autoFocus={to.length === 0}
          />
        </Row>
        {showCc && (
          <>
            <Row label="Cc">
              <RecipientInput value={cc} onChange={touchRecipients("cc", setCc)} label="Cc" />
            </Row>
            <Row label="Bcc">
              <RecipientInput value={bcc} onChange={touchRecipients("bcc", setBcc)} label="Bcc" />
            </Row>
          </>
        )}
        <Row label="Subject">
          <Input
            variant="bare"
            value={subject}
            aria-label="Subject"
            onChange={(event) => touch(setSubject)(event.target.value)}
            className="h-10 text-sm"
          />
        </Row>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <RichEditor
          initialHtml={initialHtml}
          onChange={touch(setHtml)}
          placeholder="Write your message"
          className="flex-1"
        />
        {signature && (
          <div
            className="shrink-0 px-5 pb-3 text-[13px] text-muted-foreground"
            title="Signature, added when sent"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: the owner's own signature, sanitized
            dangerouslySetInnerHTML={{ __html: `-- <br>${signature}` }}
          />
        )}
      </div>

      {files.length > 0 && (
        <ul className="flex shrink-0 flex-wrap gap-1.5 px-4 py-2">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center gap-1.5 rounded-md border border-border bg-tonal py-1 pr-1 pl-2.5 text-xs"
            >
              <Icon
                name={file.uploading ? "progress_activity" : "attach_file"}
                size={14}
                className={cn("text-muted-foreground", file.uploading && "animate-spin")}
              />
              <span className="max-w-44 truncate">{file.filename}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {formatBytes(file.size_bytes)}
              </span>
              <button
                type="button"
                aria-label={`Remove ${file.filename}`}
                disabled={file.uploading}
                onClick={() => touch(setFiles)(files.filter((f) => f.id !== file.id))}
                className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-tonal-hover hover:text-foreground"
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer className="flex h-16 shrink-0 items-center gap-1 px-4 pb-[env(safe-area-inset-bottom)]">
        <Tooltip label="Ctrl + Enter" side="top">
          <Button
            variant="primary"
            icon="send"
            loading={send.isPending}
            disabled={uploading || !mailbox}
            onClick={submit}
          >
            Send
          </Button>
        </Tooltip>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => attach(event.target.files)}
        />
        <Tooltip label="Attach files" side="top">
          <IconButton
            icon="attach_file"
            label="Attach files"
            onClick={() => fileInput.current?.click()}
          />
        </Tooltip>
        <Tooltip label="Discard draft" side="top">
          <IconButton
            icon="delete"
            label="Discard draft"
            variant="ghost"
            className="ml-auto"
            onClick={discard}
          />
        </Tooltip>
      </footer>
    </motion.section>
  );
}

function Row({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-center">
      <span className="w-20 shrink-0 pl-5 text-[13px] text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
      {action}
    </div>
  );
}
