import { type FormEvent, useId, useState } from "react";
import {
  Badge,
  Button,
  ColorInput,
  ColorPicker,
  ConfirmDialog,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Icon,
  IconButton,
  Input,
  List,
  PALETTE,
  Textarea,
  toast,
} from "@/components/kit";
import {
  errorMessage,
  useCreateMailbox,
  useDeleteMailbox,
  useMailboxes,
  useUpdateMailbox,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { EMAIL } from "@/lib/mail";
import { receivingNote } from "@/lib/settings";
import type { Mailbox } from "@/lib/types";
import {
  emptyBox,
  LoadError,
  Notice,
  PageAction,
  PageLoading,
  rowActions,
  SwitchRow,
} from "./parts";

type Note = ReturnType<typeof receivingNote>;

/** Row actions: always there on touch, shown on hover or focus with a pointer. */
const ROW_ACTIONS = cn("flex shrink-0 items-center gap-1", rowActions);

/** Every address you send from or receive at. */
export default function Mailboxes() {
  const mailboxes = useMailboxes();
  const [adding, setAdding] = useState(false);
  // What creating a subdomain mailbox did about receiving; outlives the dialog.
  const [note, setNote] = useState<Note>(null);
  if (mailboxes.isPending) return <PageLoading />;
  if (mailboxes.isError) return <LoadError error={mailboxes.error} retry={mailboxes.refetch} />;

  return (
    <div className="space-y-4">
      <PageAction>
        <Button variant="primary" icon="add" onClick={() => setAdding(true)}>
          Add mailbox
        </Button>
      </PageAction>
      {note && <Notice tone={note.ok ? "info" : "warning"}>{note.text}</Notice>}
      {mailboxes.data.length === 0 ? (
        <div className={emptyBox}>
          <p className="text-muted-foreground">
            No mailboxes yet. Add a domain first, then a mailbox on it.
          </p>
        </div>
      ) : (
        <List>
          {mailboxes.data.map((m) => (
            <MailboxRow key={m.id} mailbox={m} />
          ))}
        </List>
      )}
      <CreateMailbox open={adding} onOpenChange={setAdding} onCreated={setNote} />
    </div>
  );
}

function MailboxRow({ mailbox }: { mailbox: Mailbox }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const update = useUpdateMailbox();
  const remove = useDeleteMailbox();
  const panelId = useId();

  return (
    <li className="group/row">
      <div className="flex items-center gap-1 pr-3 transition-colors hover:bg-box">
        <button
          type="button"
          aria-expanded={editing}
          aria-controls={panelId}
          onClick={() => setEditing(!editing)}
          className="flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-4 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <Icon
            name="expand_more"
            size={18}
            className={cn(
              "shrink-0 text-muted-foreground transition-transform",
              editing && "rotate-180",
            )}
          />
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-[2px]"
            style={{ background: mailbox.color }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">
              {mailbox.display_name || mailbox.address}
            </span>
            {mailbox.display_name && (
              <span className="block truncate font-mono text-xs text-muted-foreground">
                {mailbox.address}
              </span>
            )}
          </span>
          {mailbox.is_default && <Badge size="sm">Default</Badge>}
          {mailbox.is_catch_all && <Badge size="sm">Catch-all</Badge>}
        </button>
        <div className={ROW_ACTIONS}>
          {!mailbox.is_default && (
            <IconButton
              icon="star"
              size="sm"
              label={`Make ${mailbox.address} the default`}
              onClick={() =>
                update.mutate(
                  { id: mailbox.id, is_default: true },
                  {
                    onSuccess: () => toast.success(`${mailbox.address} is the default now`),
                    onError: (error) => toast.error(errorMessage(error)),
                  },
                )
              }
            />
          )}
          <IconButton
            icon="delete"
            size="sm"
            label={`Delete ${mailbox.address}`}
            onClick={() => setDeleting(true)}
          />
        </div>
      </div>
      {editing && (
        <div id={panelId} className="border-t border-border px-4 pt-4 pb-5 sm:pl-9.5">
          <EditMailbox mailbox={mailbox} onDone={() => setEditing(false)} />
        </div>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${mailbox.address}?`}
        description="The mailbox and every message in it are deleted for good."
        consequences="Mail sent to this address afterwards goes to the catch-all, or is dropped if there is none."
        phrase={mailbox.address}
        confirmLabel="Delete mailbox"
        onConfirm={async () => {
          await remove.mutateAsync(mailbox.id);
          toast.success(`${mailbox.address} deleted`);
        }}
      />
    </li>
  );
}

interface Settings {
  display_name: string;
  color: string;
  signature: string;
  is_catch_all: boolean;
  is_default: boolean;
}

/** The fields create and edit share. */
function SettingsFields({
  value,
  onChange,
}: {
  value: Settings;
  onChange: (next: Settings) => void;
}) {
  const set = <K extends keyof Settings>(key: K, v: Settings[K]) =>
    onChange({ ...value, [key]: v });
  return (
    <>
      <Field label="Display name" description="Shown as the sender name.">
        <Input
          value={value.display_name}
          onChange={(event) => set("display_name", event.target.value)}
          placeholder="Ada Lovelace"
          maxLength={200}
        />
      </Field>
      <Field label="Colour">
        <div className="flex flex-wrap items-center gap-3">
          <ColorPicker
            value={value.color}
            onChange={(color) => set("color", color)}
            label="Mailbox colour"
          />
          <ColorInput
            value={value.color}
            onChange={(color) => set("color", color)}
            label="Mailbox colour"
            className="w-36"
          />
        </div>
      </Field>
      <Field label="Signature" description="Plain text or HTML.">
        <Textarea
          value={value.signature}
          onChange={(event) => set("signature", event.target.value)}
          placeholder={"Best,\nAda"}
          className="font-mono text-[13px]"
        />
      </Field>
      <div className="space-y-4 border-t border-border pt-4">
        <SwitchRow
          label="Catch-all"
          description="Also receives mail for addresses on this domain that have no mailbox."
          checked={value.is_catch_all}
          onCheckedChange={(on) => set("is_catch_all", on)}
        />
        <SwitchRow
          label="Default"
          description="New mail starts from this address."
          checked={value.is_default}
          onCheckedChange={(on) => set("is_default", on)}
        />
      </div>
    </>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

function CreateMailbox({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (note: Note) => void;
}) {
  const blank: Settings = {
    display_name: "",
    color: PALETTE[1],
    signature: "",
    is_catch_all: false,
    is_default: false,
  };
  const [address, setAddress] = useState("");
  const [settings, setSettings] = useState(blank);
  const create = useCreateMailbox();
  const valid = EMAIL.test(address.trim());

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    onCreated(null);
    create.mutate(
      {
        address: address.trim(),
        display_name: settings.display_name.trim(),
        color: HEX.test(settings.color) ? settings.color : "",
        signature: settings.signature.trim() || null,
        is_catch_all: settings.is_catch_all,
        is_default: settings.is_default,
      },
      {
        onSuccess: (m) => {
          toast.success(`${m.address} created`);
          onCreated(receivingNote(m.receiving));
          setAddress("");
          setSettings(blank);
          onOpenChange(false);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a mailbox</DialogTitle>
          <DialogDescription>On one of your domains, or a subdomain of one.</DialogDescription>
        </DialogHeader>
        <form id="create-mailbox" className="flex flex-col gap-4" onSubmit={submit}>
          <Field label="Address" error={address && !valid ? "Not an email address" : undefined}>
            <Input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="hello@example.com"
              type="email"
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
              required
            />
          </Field>
          <SettingsFields value={settings} onChange={setSettings} />
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            type="submit"
            form="create-mailbox"
            variant="primary"
            loading={create.isPending}
            disabled={!valid}
          >
            Create mailbox
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The inline editor under a mailbox row; it starts from the saved values each time it opens. */
function EditMailbox({ mailbox, onDone }: { mailbox: Mailbox; onDone: () => void }) {
  const [settings, setSettings] = useState<Settings>(() => ({
    display_name: mailbox.display_name,
    color: mailbox.color,
    signature: mailbox.signature ?? "",
    is_catch_all: mailbox.is_catch_all,
    is_default: mailbox.is_default,
  }));
  const update = useUpdateMailbox();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!settings.display_name.trim()) return;
    update.mutate(
      {
        id: mailbox.id,
        display_name: settings.display_name.trim(),
        color: HEX.test(settings.color) ? settings.color : mailbox.color,
        signature: settings.signature.trim() || null,
        is_catch_all: settings.is_catch_all,
        is_default: settings.is_default,
      },
      {
        onSuccess: () => toast.success("Mailbox saved"),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
    onDone();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <SettingsFields value={settings} onChange={setSettings} />
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!settings.display_name.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}
