import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon, IconButton } from "@/components/kit";
import { useSetImageTrust } from "@/lib/api";
import { cn } from "@/lib/cn";
import { escapeHtml } from "@/lib/mail";
import { frameCsp, frameStyles, prepareEmail, textToHtml } from "@/lib/sanitize";
import { useResolvedTheme } from "@/lib/theme";

/**
 * A message body in a sandboxed iframe. No allow-scripts: nothing in the
 * message can run. allow-same-origin lets the parent measure the document
 * and lets inline (cid:) images load from our attachment URL with the
 * session cookie; the CSP inside allows images only from there (plus remote
 * images once the reader says so).
 */
export function EmailFrame({
  html,
  text,
  sender,
  imagesAllowed,
  inlineImages,
}: {
  html: string | null | undefined;
  text: string | null | undefined;
  /** Who sent it, so "always show images" is remembered for them. */
  sender?: string;
  /** What the reader decided about this sender before (image-trust). */
  imagesAllowed: boolean;
  inlineImages: Record<string, string>;
}) {
  const [showImages, setShowImages] = useState(imagesAllowed);
  const [showQuote, setShowQuote] = useState(false);
  const trust = useSetImageTrust();
  useEffect(() => setShowImages(imagesAllowed), [imagesAllowed]);

  const prepared = useMemo(
    () =>
      prepareEmail(html?.trim() ? html : textToHtml(text ?? ""), {
        showRemoteImages: showImages,
        inlineImages,
      }),
    [html, text, showImages, inlineImages],
  );

  function decide(allowed: boolean, remember: boolean) {
    setShowImages(allowed);
    if (remember && sender) trust.mutate({ sender, allowed });
  }

  return (
    <div>
      {prepared.blockedImages > 0 && !showImages && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-muted-foreground">
          <Icon name="hide_image" size={18} />
          <span className="mr-auto">
            {prepared.blockedImages} remote {prepared.blockedImages === 1 ? "image" : "images"}{" "}
            blocked to stop read tracking.
          </span>
          <button
            type="button"
            className="font-medium text-foreground hover:underline"
            onClick={() => decide(true, false)}
          >
            Show images
          </button>
          {sender && (
            <button
              type="button"
              className="font-medium text-foreground hover:underline"
              onClick={() => decide(true, true)}
            >
              Always for this sender
            </button>
          )}
        </div>
      )}
      {prepared.remoteImages > 0 && imagesAllowed && showImages && sender && (
        <div className="mb-3 flex items-center gap-2 text-[13px] text-muted-foreground">
          <Icon name="image" size={18} />
          <span>Images load for {sender}.</span>
          <button
            type="button"
            className="font-medium text-foreground hover:underline"
            onClick={() => decide(false, true)}
          >
            Stop loading them
          </button>
        </div>
      )}

      <Frame body={prepared.html} onWhite={prepared.ownsBackground} allowRemote={showImages} />

      {prepared.quoted && (
        <>
          <IconButton
            icon="more_horiz"
            label={showQuote ? "Hide quoted text" : "Show quoted text"}
            aria-expanded={showQuote}
            size="sm"
            variant="tonal"
            className="mt-2 h-6 w-9"
            onClick={() => setShowQuote((v) => !v)}
          />
          {showQuote && (
            <div className="mt-2">
              <Frame
                body={prepared.quoted}
                onWhite={prepared.ownsBackground}
                allowRemote={showImages}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** When to measure again after load, as fonts and images settle (ms). */
const SETTLE = [0, 120, 400, 1200];

function Frame({
  body,
  onWhite,
  allowRemote,
}: {
  body: string;
  onWhite: boolean;
  allowRemote: boolean;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);
  const theme = useResolvedTheme();

  const srcDoc = useMemo(() => {
    const csp = frameCsp(allowRemote, `${window.location.origin}/api/app/attachments/`);
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}"><base target="_blank"><style>${frameStyles(onWhite, theme)}</style></head><body>${body}</body></html>`;
  }, [body, onWhite, allowRemote, theme]);

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc?.body) return;
    const next = Math.ceil(
      Math.max(
        doc.body.getBoundingClientRect().height,
        doc.documentElement.getBoundingClientRect().height,
        doc.body.scrollHeight,
      ),
    );
    if (next > 0) setHeight(Math.min(Math.max(next, 24), 30000));
  }, []);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let inner: ResizeObserver | undefined;
    const timers: number[] = [];
    const onLoad = () => {
      measure();
      const doc = frame.contentDocument;
      if (doc?.body) {
        inner = new ResizeObserver(measure);
        inner.observe(doc.body);
        for (const image of Array.from(doc.images)) {
          image.addEventListener("load", measure, { once: true });
          image.addEventListener("error", measure, { once: true });
        }
        doc.fonts?.ready.then(measure).catch(() => {});
      }
      for (const delay of SETTLE) timers.push(window.setTimeout(measure, delay));
    };
    frame.addEventListener("load", onLoad);
    // A narrower pane rewraps the text taller.
    const outer = new ResizeObserver(measure);
    outer.observe(frame);
    return () => {
      frame.removeEventListener("load", onLoad);
      inner?.disconnect();
      outer.disconnect();
      for (const timer of timers) clearTimeout(timer);
    };
  }, [measure]);

  return (
    <div className={cn(onWhite && "overflow-hidden rounded-xl border border-border bg-white")}>
      <iframe
        ref={ref}
        title="Message body"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc}
        className="block w-full border-0 bg-transparent"
        style={{ height: height || 24 }}
      />
    </div>
  );
}
