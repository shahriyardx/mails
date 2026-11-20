import { useState } from "react";
import { Link } from "react-router";
import {
  Button,
  ColorPicker,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  PALETTE,
  Tooltip,
  toast,
} from "@/components/kit";
import { errorMessage, useChangeThreads, useCreateLabel, useLabels } from "@/lib/api";

/** Puts labels on threads or takes them off; makes a new one on the spot. */
export function LabelMenu({
  threadIds,
  applied = [],
  onDone,
}: {
  /** One open thread, or every selected one. */
  threadIds: string[];
  /** Label ids already on the thread (empty for a multiple selection). */
  applied?: string[];
  onDone?: () => void;
}) {
  const labels = useLabels();
  const change = useChangeThreads();
  const create = useCreateLabel();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(PALETTE[0]);

  function toggle(id: string, on: boolean) {
    change.mutate(
      { ids: threadIds, change: on ? { add_labels: [id] } : { remove_labels: [id] } },
      { onSuccess: onDone, onError: (e) => toast.error(errorMessage(e)) },
    );
  }

  function submit() {
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), color },
      {
        onSuccess: (label) => {
          toggle(label.id, true);
          setCreating(false);
          setName("");
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  return (
    <>
      <DropdownMenu>
        <Tooltip label="Labels">
          <DropdownMenuTrigger
            disabled={threadIds.length === 0}
            render={<IconButton icon="label" label="Labels" />}
          />
        </Tooltip>
        <DropdownMenuContent className="w-60">
          <DropdownMenuLabel>
            {threadIds.length > 1 ? `Label ${threadIds.length} conversations` : "Labels"}
          </DropdownMenuLabel>
          {labels.data?.map((label) => (
            <DropdownMenuCheckboxItem
              key={label.id}
              checked={applied.includes(label.id)}
              closeOnClick={false}
              onCheckedChange={(on) => toggle(label.id, on)}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: label.color }}
                aria-hidden
              />
              <span className="truncate">{label.name}</span>
            </DropdownMenuCheckboxItem>
          ))}
          {labels.data?.length === 0 && (
            <p className="px-2.5 py-2 text-[13px] text-muted-foreground">No labels yet.</p>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem icon="new_label" onClick={() => setCreating(true)}>
            New label
          </DropdownMenuItem>
          <DropdownMenuLinkItem icon="settings" render={<Link to="/settings/labels" />}>
            Manage labels
          </DropdownMenuLinkItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New label</DialogTitle>
          </DialogHeader>
          <Field label="Name">
            <Input
              value={name}
              autoFocus
              placeholder="Newsletters"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && submit()}
            />
          </Field>
          <Field label="Colour">
            <ColorPicker value={color} onChange={setColor} />
          </Field>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={create.isPending}
              disabled={!name.trim()}
              onClick={submit}
            >
              Create and apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
