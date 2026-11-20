import { type FormEvent, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  List,
  ListEmpty,
  ListRow,
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
import { EMAIL } from "@/lib/mail";
import { receivingNote } from "@/lib/settings";
import type { Mailbox } from "@/lib/types";
import { LoadError, Notice, PageLoading, SwitchRow } from "./parts";

/** Every address you send from or receive at. */
export default function Mailboxes() {
  const mailboxes = useMailboxes();
  if (mailboxes.isPending) return <PageLoading />;
  if (mailboxes.isError) return <LoadError error={mailboxes.error} retry={mailboxes.refetch} />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Mailboxes</CardTitle>
          <CardDescription>
            One per address you send from or receive at. Mail to an address with no mailbox goes to
            the domain's catch-all, if it has one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <List className="bg-box">
            {mailboxes.data.map((m) => (
              <MailboxRow key={m.id} mailbox={m} />
            ))}
            {mailboxes.data.length === 0 && (
              <ListEmpty>No mailboxes yet. Add a domain first, then create one below.</ListEmpty>
            )}
          </List>
        </CardContent>
      </Card>
      <CreateMailbox />
    </div>
  );
}

function MailboxRow({ mailbox }: { mailbox: Mailbox }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const update = useUpdateMailbox();
  const remove = useDeleteMailbox();

  return (
    <ListRow
      title={
        <span className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: mailbox.color }}
          />
          <span className="truncate font-mono">{mailbox.address}</span>
        </span>
      }
      description={mailbox.display_name}
      action={
        <>
          {mailbox.is_default && <Badge className="hidden sm:inline-flex">Default</Badge>}
          {mailbox.is_catch_all && <Badge className="hidden sm:inline-flex">Catch-all</Badge>}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<IconButton icon="more_vert" label={`Actions for ${mailbox.address}`} />}
            />
            <DropdownMenuContent>
              <DropdownMenuItem icon="edit" onClick={() => setEditing(true)}>
                Edit
              </DropdownMenuItem>
              {!mailbox.is_default && (
                <DropdownMenuItem
                  icon="check_circle"
                  onClick={() =>
                    update.mutate(
                      { id: mailbox.id, is_default: true },
                      {
                        onSuccess: () => toast.success(`${mailbox.address} is the default now`),
                        onError: (error) => toast.error(errorMessage(error)),
                      },
                    )
                  }
                >
                  Make default
                </DropdownMenuItem>
              )}
              <DropdownMenuItem icon="delete" destructive onClick={() => setDeleting(true)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      {(mailbox.is_default || mailbox.is_catch_all) && (
        <div className="mt-1 flex gap-1 sm:hidden">
          {mailbox.is_default && <Badge size="sm">Default</Badge>}
          {mailbox.is_catch_all && <Badge size="sm">Catch-all</Badge>}
        </div>
      )}
      <EditMailbox mailbox={mailbox} open={editing} onOpenChange={setEditing} />
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
    </ListRow>
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
      <Field label="Colour" description="Marks this mailbox in the mail list.">
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
      <Field label="Signature" description="Added under new mail. Plain text, or HTML.">
        <Textarea
          value={value.signature}
          onChange={(event) => set("signature", event.target.value)}
          placeholder={"Best,\nAda"}
          className="font-mono text-[13px]"
        />
      </Field>
      <SwitchRow
        label="Catch-all"
        description="Also receives mail for addresses on this domain that have no mailbox."
        checked={value.is_catch_all}
        onCheckedChange={(on) => set("is_catch_all", on)}
      />
      <SwitchRow
        label="Default"
        description="New mail is written from this address unless you pick another."
        checked={value.is_default}
        onCheckedChange={(on) => set("is_default", on)}
      />
    </>
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

function CreateMailbox() {
  const blank: Settings = {
    display_name: "",
    color: PALETTE[1],
    signature: "",
    is_catch_all: false,
    is_default: false,
  };
  const [address, setAddress] = useState("");
  const [settings, setSettings] = useState(blank);
  const [note, setNote] = useState<ReturnType<typeof receivingNote>>(null);
  const create = useCreateMailbox();
  const valid = EMAIL.test(address.trim());

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setNote(null);
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
          setNote(receivingNote(m.receiving));
          setAddress("");
          setSettings(blank);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a mailbox</CardTitle>
        <CardDescription>
          On a domain you have, or a subdomain of one. For a new subdomain, Mails publishes its MX
          records in Cloudflare when the parent domain already receives here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit}>
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
          <div>
            <Button type="submit" variant="primary" loading={create.isPending} disabled={!valid}>
              Create mailbox
            </Button>
          </div>
          {note && <Notice tone={note.ok ? "info" : "warning"}>{note.text}</Notice>}
        </form>
      </CardContent>
    </Card>
  );
}

function EditMailbox({
  mailbox,
  open,
  onOpenChange,
}: {
  mailbox: Mailbox;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const initial = (): Settings => ({
    display_name: mailbox.display_name,
    color: mailbox.color,
    signature: mailbox.signature ?? "",
    is_catch_all: mailbox.is_catch_all,
    is_default: mailbox.is_default,
  });
  const [settings, setSettings] = useState(initial);
  const [wasOpen, setWasOpen] = useState(open);
  // Start from the saved values each time the dialog opens.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSettings(initial());
  }
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
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit mailbox</DialogTitle>
          <DialogDescription className="font-mono">{mailbox.address}</DialogDescription>
        </DialogHeader>
        <form id={`edit-${mailbox.id}`} className="flex flex-col gap-4" onSubmit={submit}>
          <SettingsFields value={settings} onChange={setSettings} />
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            type="submit"
            form={`edit-${mailbox.id}`}
            variant="primary"
            disabled={!settings.display_name.trim()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
