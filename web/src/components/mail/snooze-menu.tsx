import { type ReactElement, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  Tooltip,
} from "@/components/kit";
import { snoozeLabel, snoozePresets, toLocalInput } from "@/lib/snooze";

/** "Snooze": the presets, "Pick a date & time", and Unsnooze when it is snoozed. */
export function SnoozeMenu({
  onSnooze,
  snoozed = false,
  trigger,
}: {
  /** An ISO time, or null to wake it now. */
  onSnooze: (until: string | null) => void;
  snoozed?: boolean;
  trigger?: ReactElement;
}) {
  const [picking, setPicking] = useState(false);
  const now = new Date();
  return (
    <>
      <DropdownMenu>
        <Tooltip label="Snooze">
          <DropdownMenuTrigger render={trigger ?? <IconButton icon="snooze" label="Snooze" />} />
        </Tooltip>
        <DropdownMenuContent className="w-60">
          <DropdownMenuLabel>Snooze until</DropdownMenuLabel>
          {snoozePresets(now).map((p) => (
            <DropdownMenuItem key={p.label} onClick={() => onSnooze(p.at.toISOString())}>
              <span className="flex-1">{p.label}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {snoozeLabel(p.at, now)}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setPicking(true)}>Pick a date & time</DropdownMenuItem>
          {snoozed && (
            <DropdownMenuItem icon="inbox" onClick={() => onSnooze(null)}>
              Unsnooze
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <SnoozeDialog open={picking} onOpenChange={setPicking} onSnooze={onSnooze} />
    </>
  );
}

/** The presets and a date & time field, in a dialog (the "b" key, "Pick a date & time"). */
export function SnoozeDialog({
  open,
  onOpenChange,
  onSnooze,
  count = 1,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSnooze: (until: string) => void;
  count?: number;
}) {
  const now = new Date();
  const [value, setValue] = useState(() => toLocalInput(snoozePresets(now)[1]!.at));
  // datetime-local is local time, which is what new Date() reads it as.
  const picked = new Date(value);
  const valid = !Number.isNaN(picked.getTime()) && picked.getTime() > Date.now();
  const pick = (until: Date) => {
    onSnooze(until.toISOString());
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{count > 1 ? `Snooze ${count} conversations` : "Snooze until"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-1.5">
          {snoozePresets(now).map((p) => (
            <Button
              key={p.label}
              variant="tonal"
              className="justify-between"
              onClick={() => pick(p.at)}
            >
              {p.label}
              <span className="font-mono text-xs text-muted-foreground">
                {snoozeLabel(p.at, now)}
              </span>
            </Button>
          ))}
        </div>
        <Field label="Date and time">
          <Input
            type="datetime-local"
            value={value}
            min={toLocalInput(now)}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && valid && pick(picked)}
          />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon="snooze" disabled={!valid} onClick={() => pick(picked)}>
            Snooze
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
