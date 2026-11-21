import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/kit";
import type { Command } from "@/lib/commands";
import { inTextOrDialog } from "@/lib/hooks";

const Palette = lazy(() => import("./command-palette"));

/**
 * Ctrl+K / Cmd+K anywhere (not while typing or in another dialog): a
 * palette of folders, mailboxes, domains, labels, settings pages and
 * actions, plus "Search mail for …".
 */
export function CommandMenu() {
  const [open, setOpen] = useState(false);
  // The picked command runs once the palette has closed, so its focus
  // handling (back to where it was) cannot pull focus from, say, the composer.
  const picked = useRef<Command | null>(null);

  // Fetched once the app is up, so keys typed right after Ctrl+K are not lost.
  useEffect(() => {
    void import("./command-palette");
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "k") {
        return;
      }
      if (!open && inTextOrDialog(event.target)) return;
      event.preventDefault();
      setOpen(!open);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(now) => {
        if (now) return;
        picked.current?.run();
        picked.current = null;
      }}
    >
      {/* Pinned near the top, so it does not jump as the list grows and shrinks. */}
      <DialogContent
        showClose={false}
        className="mt-[12dvh] max-w-xl gap-0 self-start overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Command menu</DialogTitle>
        <Suspense fallback={<div className="h-13" />}>
          <Palette
            onPick={(command) => {
              picked.current = command;
              setOpen(false);
            }}
          />
        </Suspense>
      </DialogContent>
    </Dialog>
  );
}
