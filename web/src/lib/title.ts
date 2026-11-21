import { useEffect } from "react";

/** The tab title: "(3) Inbox · Mails", with no "(0)". */
export function documentTitle(view: string, unread = 0) {
  return `${unread > 0 ? `(${unread}) ` : ""}${view} · Mails`;
}

/**
 * Sets the tab title for this screen. Pass `unread` (Inbox, from the
 * sidebar's counts query) on mail screens; a dot on the tab icon shows it.
 */
export function useDocumentTitle(view: string, unread?: number) {
  useEffect(() => {
    document.title = documentTitle(view, unread);
    showDot((unread ?? 0) > 0);
  }, [view, unread]);
}

// The tab icon with a dot: favicon.svg with a circle added, as a data URL.
const ICON = "/favicon.svg";
let dotted: Promise<string> | undefined;
let wantDot = false;

function showDot(on: boolean) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link || on === wantDot) return;
  wantDot = on;
  if (!on) {
    link.href = ICON;
    return;
  }
  dotted ??= fetch(ICON)
    .then((res) => res.text())
    .then(
      (svg) =>
        `data:image/svg+xml,${encodeURIComponent(
          svg.replace(
            "</svg>",
            '<circle cx="102" cy="26" r="22" fill="#e5534b" stroke="#16151a" stroke-width="6"/></svg>',
          ),
        )}`,
    );
  dotted.then(
    (href) => {
      if (wantDot) link.href = href;
    },
    () => {}, // No dot then; the title still has the count.
  );
}
