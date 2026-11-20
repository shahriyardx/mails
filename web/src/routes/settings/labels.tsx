import { type FormEvent, useState } from "react";
import {
  Button,
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
  ListRow,
  PALETTE,
  toast,
} from "@/components/kit";
import { errorMessage, useCreateLabel, useDeleteLabel, useLabels, useUpdateLabel } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Label } from "@/lib/types";
import { emptyBox, LoadError, PageAction, PageLoading, rowActions } from "./parts";

const HEX = /^#[0-9a-f]{6}$/i;

/** Tags for conversations: name and colour. */
export default function Labels() {
  const labels = useLabels();
  const [editing, setEditing] = useState<Label | "new" | null>(null);
  if (labels.isPending) return <PageLoading />;
  if (labels.isError) return <LoadError error={labels.error} retry={labels.refetch} />;
  const add = () => setEditing("new");

  return (
    <div className="space-y-4">
      <PageAction>
        <Button variant="primary" icon="new_label" onClick={add}>
          New label
        </Button>
      </PageAction>
      {labels.data.length === 0 ? (
        <div className={emptyBox}>
          <p className="text-muted-foreground">No labels yet.</p>
          <Button variant="primary" icon="new_label" className="mt-4" onClick={add}>
            New label
          </Button>
        </div>
      ) : (
        <List>
          {labels.data.map((label) => (
            <LabelRow key={label.id} label={label} onEdit={() => setEditing(label)} />
          ))}
        </List>
      )}
      <p className="text-[13px] text-muted-foreground">
        Filters can add a label to new mail as it arrives.
      </p>
      <LabelDialog label={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function LabelRow({ label, onEdit }: { label: Label; onEdit: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const remove = useDeleteLabel();

  return (
    <ListRow
      className="relative"
      title={
        // The name is the row's main button; its ::after stretches over the row.
        <button
          type="button"
          onClick={onEdit}
          className="flex w-full min-w-0 items-center gap-2.5 text-left outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
        >
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-[2px]"
            style={{ background: label.color }}
          />
          <span className="truncate">{label.name}</span>
          <span className="font-mono text-xs font-normal text-muted-foreground">{label.color}</span>
        </button>
      }
      action={
        <div className={cn("relative flex items-center gap-1", rowActions)}>
          <IconButton icon="edit" size="sm" label={`Edit ${label.name}`} onClick={onEdit} />
          <IconButton
            icon="delete"
            size="sm"
            label={`Delete ${label.name}`}
            onClick={() => setDeleting(true)}
          />
        </div>
      }
    >
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

/** Adds a label ("new") or edits one; closed when `label` is null. */
function LabelDialog({ label, onClose }: { label: Label | "new" | null; onClose: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PALETTE[0]);
  const [shown, setShown] = useState<typeof label>(null);
  // Load the form each time the dialog opens.
  if (label !== shown) {
    setShown(label);
    if (label) {
      setName(label === "new" ? "" : label.name);
      setColor(label === "new" ? PALETTE[0] : label.color);
    }
  }
  const create = useCreateLabel();
  const update = useUpdateLabel();
  const valid = name.trim() !== "" && HEX.test(color);
  const isNew = label === "new";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || !label) return;
    const onError = (error: unknown) => toast.error(errorMessage(error));
    if (label === "new") {
      create.mutate(
        { name: name.trim(), color },
        {
          onSuccess: (added) => {
            toast.success(`Label ${added.name} added`);
            onClose();
          },
          onError,
        },
      );
    } else {
      update.mutate({ id: label.id, name: name.trim(), color }, { onError });
      onClose();
    }
  }

  return (
    <Dialog open={label !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? "New label" : "Edit label"}</DialogTitle>
        </DialogHeader>
        <form id="label-form" className="flex flex-col gap-4" onSubmit={submit}>
          <Field label="Name">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Newsletters"
              maxLength={100}
            />
          </Field>
          <Field label="Colour" error={HEX.test(color) ? undefined : "A hex value like #8fa8c8"}>
            <div className="flex flex-wrap items-center gap-3">
              <ColorPicker value={color} onChange={setColor} label="Label colour" />
              <ColorInput value={color} onChange={setColor} label="Label colour" className="w-36" />
            </div>
          </Field>
        </form>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            type="submit"
            form="label-form"
            variant="primary"
            loading={create.isPending}
            disabled={!valid}
          >
            {isNew ? "Add label" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
