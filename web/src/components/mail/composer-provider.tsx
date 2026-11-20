import { AnimatePresence } from "motion/react";
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Address } from "@/lib/types";

const Composer = lazy(() => import("./composer"));

/** What the composer opens with: blank, a reply, a forward, or a saved draft. */
export interface ComposerDraft {
  draftId?: string;
  mailboxId?: string;
  to?: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject?: string;
  html?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
  /** Files already stored: a draft's own, or a forwarded message's. */
  attachments?: { id: string; filename: string; size_bytes: number }[];
  /** Heading: "New message", "Reply", "Forward". */
  title?: string;
}

interface ComposerApi {
  open: (draft?: ComposerDraft) => void;
  close: () => void;
  isOpen: boolean;
}

const Context = createContext<ComposerApi | null>(null);

export function useComposer() {
  const api = useContext(Context);
  if (!api) throw new Error("useComposer outside ComposerProvider");
  return api;
}

/** One composer at a time, floating over whatever screen is open. */
export function ComposerProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<(ComposerDraft & { key: number }) | null>(null);
  // The open composer's save, so opening another never drops unsaved text.
  const flush = useRef<(() => Promise<boolean>) | null>(null);
  const open = useCallback((next?: ComposerDraft) => {
    void (async () => {
      // Not saved (the reason is toasted): the open composer stays, text and all.
      if (flush.current && !(await flush.current())) return;
      setDraft({ ...next, key: Date.now() });
    })();
  }, []);
  const close = useCallback(() => setDraft(null), []);
  const api = useMemo(() => ({ open, close, isOpen: draft !== null }), [open, close, draft]);

  return (
    <Context.Provider value={api}>
      {children}
      <Suspense>
        <AnimatePresence>
          {draft && <Composer key={draft.key} draft={draft} onClose={close} flushRef={flush} />}
        </AnimatePresence>
      </Suspense>
    </Context.Provider>
  );
}
