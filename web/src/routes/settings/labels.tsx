import { type FormEvent, useState } from "react";
import {
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  IconButton,
  Input,
  List,
  ListEmpty,
  ListRow,
  PALETTE,
  toast,
} from "@/components/kit";
import { errorMessage, useCreateLabel, useDeleteLabel, useLabels, useUpdateLabel } from "@/lib/api";
import type { Label } from "@/lib/types";
import { LoadError, PageLoading } from "./parts";

const HEX = /^#[0-9a-f]{6}$/i;

/** Tags for conversations: name and colour. */
export default function Labels() {
  const labels = useLabels();
  if (labels.isPending) return <PageLoading />;
  if (labels.isError) return <LoadError error={labels.error} retry={labels.refetch} />;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Labels</CardTitle>
          <CardDescription>
            Tag conversations to find them again. Filters can add a label to new mail.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <List className="bg-box">
            {labels.data.map((label) => (
              <LabelRow key={label.id} label={label} />
            ))}
            {labels.data.length === 0 && <ListEmpty>No labels yet.</ListEmpty>}
          </List>
        </CardContent>
      </Card>
      <CreateLabel />
    </div>
  );
}

function LabelFields({
  name,
  color,
  onName,
  onColor,
}: {
  name: string;
  color: string;
  onName: (v: string) => void;
  onColor: (v: string) => void;
}) {
  return (
    <>
      <Field label="Name">
        <Input
          value={name}
          onChange={(event) => onName(event.target.value)}
          placeholder="Newsletters"
          maxLength={100}
        />
      </Field>
      <Field label="Colour" error={HEX.test(color) ? undefined : "A hex value like #8fa8c8"}>
        <div className="flex flex-wrap items-center gap-3">
          <ColorPicker value={color} onChange={onColor} label="Label colour" />
          <ColorInput value={color} onChange={onColor} label="Label colour" className="w-36" />
        </div>
      </Field>
    </>
  );
}

function CreateLabel() {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PALETTE[0]);
  const create = useCreateLabel();
  const valid = name.trim() !== "" && HEX.test(color);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    create.mutate(
      { name: name.trim(), color },
      {
        onSuccess: (label) => {
          toast.success(`Label ${label.name} added`);
          setName("");
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a label</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <LabelFields name={name} color={color} onName={setName} onColor={setColor} />
          <div>
            <Button type="submit" variant="primary" loading={create.isPending} disabled={!valid}>
              Add label
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function LabelRow({ label }: { label: Label }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);
  const update = useUpdateLabel();
  const remove = useDeleteLabel();
  const valid = name.trim() !== "" && HEX.test(color);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    update.mutate(
      { id: label.id, name: name.trim(), color },
      { onError: (error) => toast.error(errorMessage(error)) },
    );
    setEditing(false);
  }

  return (
    <ListRow
      title={
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className="size-3 shrink-0 rounded-full"
            style={{ background: label.color }}
          />
          <span className="truncate">{label.name}</span>
        </span>
      }
      action={
        <>
          <IconButton
            icon="edit"
            label={`Edit ${label.name}`}
            onClick={() => {
              setName(label.name);
              setColor(label.color);
              setEditing(true);
            }}
          />
          <IconButton
            icon="delete"
            label={`Delete ${label.name}`}
            onClick={() => setDeleting(true)}
          />
        </>
      }
    >
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit label</DialogTitle>
          </DialogHeader>
          <form id={`label-${label.id}`} className="flex flex-col gap-4" onSubmit={submit}>
            <LabelFields name={name} color={color} onName={setName} onColor={setColor} />
          </form>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button type="submit" form={`label-${label.id}`} variant="primary" disabled={!valid}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete the label ${label.name}?`}
        consequences="It comes off every conversation. The mail itself stays. Filters that add it stop adding a label."
        confirmLabel="Delete label"
        onConfirm={async () => {
          await remove.mutateAsync(label.id);
          toast.success(`Label ${label.name} deleted`);
        }}
      />
    </ListRow>
  );
}
