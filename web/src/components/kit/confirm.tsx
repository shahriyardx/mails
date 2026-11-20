import { type ReactNode, useId, useState } from "react";
import { errorMessage } from "@/lib/api";
import { Button } from "./button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Icon } from "./icon";
import { Input } from "./input";
import { toast } from "./toast";

/**
 * Asks before something that cannot be undone. Stays open (with a spinner)
 * while onConfirm runs, and shows its error as a toast if it throws. With
 * `phrase`, the button waits until that exact text is typed.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  consequences,
  confirmLabel = "Confirm",
  destructive = true,
  onConfirm,
  phrase,
  children,
}: {
  /** Text to type before confirming, for the worst actions. */
  phrase?: string;
  /** Extra options above the buttons (e.g. "also delete in SES"). */
  children?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** What happens, in one plain sentence. */
  consequences?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown> | unknown;
}) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const ready = !phrase || typed.trim() === phrase;

  async function confirm() {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onConfirm();
      setTyped("");
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) setTyped("");
        onOpenChange(next);
      }}
    >
      <DialogContent showClose={false} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {consequences && <p className="text-sm">{consequences}</p>}
        {children}
        {phrase && (
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            <p className="text-[13px]">
              Type{" "}
              <button
                type="button"
                title="Click to copy"
                onClick={() =>
                  navigator.clipboard.writeText(phrase).then(
                    () => toast("Copied"),
                    () => toast.error("Could not copy. Type it instead."),
                  )
                }
                className="inline-flex items-center gap-1 rounded-md bg-tonal px-1.5 py-0.5 font-mono font-medium transition-colors hover:bg-tonal-hover focus-visible:outline-2 focus-visible:outline-ring"
              >
                {phrase}
                <Icon name="content_copy" size={14} className="text-muted-foreground" />
              </button>{" "}
              to confirm
            </p>
            <Input
              id={inputId}
              aria-label={`Type ${phrase} to confirm`}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </form>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={busy} />}>Cancel</DialogClose>
          <Button
            variant={destructive ? "destructive" : "primary"}
            loading={busy}
            disabled={!ready}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
