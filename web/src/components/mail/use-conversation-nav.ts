import { type RefObject, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useThreads } from "@/lib/api";
import { inTextOrDialog } from "@/lib/hooks";
import type { ThreadFilter } from "@/lib/types";
import { type ReadingKeyAction, readingKeyAction, threadBeside } from "./reading-keys";

/**
 * Moving on from the open conversation, in the order the list shows it:
 * the same thread query as the list, so this reads its cache.
 */
export function useConversationNav({
  threadId,
  filter,
  hrefFor,
  backHref,
}: {
  threadId: string;
  filter: ThreadFilter;
  hrefFor: (threadId: string) => string;
  backHref: string;
}) {
  const navigate = useNavigate();
  const list = useThreads(filter);
  const rows = list.data?.pages.flatMap((page) => page.data.map((t) => t.id)) ?? [];
  return {
    /** j / k: the next or previous conversation, if there is one. */
    step(dir: 1 | -1) {
      const id = threadBeside(rows, threadId, dir);
      if (id) navigate(hrefFor(id), { replace: true });
    },
    /** Back to the list (side by side, the empty pane). */
    close() {
      navigate(backHref);
    },
  };
}

/**
 * Reading shortcuts: keys pressed while focus is in `root` (the open
 * conversation, mail bodies included) or nowhere in particular. Never while
 * typing or inside a dialog or menu. On window, so the list's own keys
 * (on document) go first and can claim a key with preventDefault.
 */
export function useReadingKeys(
  root: RefObject<HTMLElement | null>,
  run: (action: ReadingKeyAction) => void,
) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || inTextOrDialog(event.target)) return;
      const target = event.target as Node;
      const idle = target === document.body || target === document.documentElement;
      if (!idle && !root.current?.contains(target)) return;
      const action = readingKeyAction(event);
      if (!action) return;
      event.preventDefault();
      latest.current(action);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [root]);
}
