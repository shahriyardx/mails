// Mail helpers shared by screens: addresses, subjects, quoting, routes, dates.
import type { Address, Message, ViewFolder } from "./types";

// ---- Routes ---------------------------------------------------------------
// /mail/:scope/:folder?t=<threadId>&reply=reply|replyAll|forward
// scope: "all", a domain (example.com) or a mailbox id (mbx_...). This
// format is shared with the browser extension and web push links.

export const FOLDERS = [
  "inbox",
  "starred",
  "snoozed",
  "sent",
  "drafts",
  "archive",
  "spam",
  "trash",
] as const;

export const FOLDER_META: Record<ViewFolder, { label: string; icon: string }> = {
  inbox: { label: "Inbox", icon: "inbox" },
  starred: { label: "Starred", icon: "star" },
  snoozed: { label: "Snoozed", icon: "snooze" },
  sent: { label: "Sent", icon: "send" },
  drafts: { label: "Drafts", icon: "draft" },
  archive: { label: "Archive", icon: "archive" },
  spam: { label: "Spam", icon: "report" },
  trash: { label: "Trash", icon: "delete" },
};

export type Scope =
  | { kind: "all" }
  | { kind: "domain"; domain: string }
  | { kind: "mailbox"; id: string };

export function parseScope(value: string | undefined): Scope {
  if (!value || value === "all") return { kind: "all" };
  if (value.startsWith("mbx_")) return { kind: "mailbox", id: value };
  return { kind: "domain", domain: value.toLowerCase() };
}

export function scopeSegment(scope: Scope) {
  return scope.kind === "all" ? "all" : scope.kind === "domain" ? scope.domain : scope.id;
}

export function isFolder(value: string | undefined): value is ViewFolder {
  return FOLDERS.includes(value as ViewFolder);
}

export function mailHref(
  scope: Scope | string,
  folder: ViewFolder,
  query?: Record<string, string>,
) {
  const segment = typeof scope === "string" ? scope : scopeSegment(scope);
  const qs = query ? new URLSearchParams(query).toString() : "";
  return `/mail/${encodeURIComponent(segment)}/${folder}${qs ? `?${qs}` : ""}`;
}

/**
 * The list URL with one filter changed. Narrowing (setting a value) closes
 * the open conversation, which may not be in the new list; clearing a filter
 * only widens the list, so the conversation stays open.
 */
export function withListParam(current: URLSearchParams, key: string, value: string | null) {
  const next = new URLSearchParams(current);
  if (value) {
    next.set(key, value);
    next.delete("t");
  } else {
    next.delete(key);
  }
  return next;
}

/**
 * Where a swiped row goes. Left archives, right deletes; both slide the row
 * away, except in Trash, where delete asks first, so the row springs back.
 */
export function swipeOutcome(
  offsetX: number,
  velocityX: number,
  folder: ViewFolder,
  far = 96,
): { action: "archive" | "delete" | null; slideOut: boolean } {
  const isFar = Math.abs(offsetX) > far || Math.abs(velocityX) > 600;
  if (!isFar || offsetX === 0) return { action: null, slideOut: false };
  if (offsetX < 0) return { action: "archive", slideOut: true };
  return { action: "delete", slideOut: folder !== "trash" };
}

// ---- Addresses ------------------------------------------------------------

export const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function formatAddress(entry: Address) {
  return entry.name ? `${entry.name} <${entry.address}>` : entry.address;
}

export function displayName(entry: Address | undefined | null) {
  return entry ? entry.name || entry.address : "Unknown";
}

/** "Ada <ada@x.com>", "<ada@x.com>" or "ada@x.com" into a name and address. */
export function parseAddress(raw: string): Address {
  const text = raw.trim();
  const angle = text.match(/^(.*?)<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1]!.trim().replace(/^"|"$/g, "").trim();
    return { name: name || null, address: angle[2]!.trim().toLowerCase() };
  }
  return { name: null, address: text.toLowerCase() };
}

/**
 * Splits typed or pasted recipient text into single addresses. Commas,
 * semicolons and newlines always separate; a space separates only once the
 * buffer holds a complete address, so `Ada Lovelace <ada@x.com>` stays whole.
 */
export function splitRecipients(input: string): string[] {
  const tokens: string[] = [];
  let buffer = "";
  let inQuotes = false;
  let inAngle = false;
  const flush = () => {
    const token = buffer.trim();
    if (token) tokens.push(token);
    buffer = "";
  };
  const complete = () => {
    const token = buffer.trim();
    return token.endsWith(">") || (token.includes("@") && !token.includes("<"));
  };
  for (const char of input) {
    if (char === '"') inQuotes = !inQuotes;
    if (!inQuotes && char === "<") inAngle = true;
    if (!inQuotes && char === ">") inAngle = false;
    const hard = char === "," || char === ";" || char === "\n" || char === "\r" || char === "\t";
    if (!inQuotes && !inAngle && (hard || (char === " " && complete()))) {
      flush();
      continue;
    }
    buffer += char;
  }
  flush();
  return tokens;
}

// ---- Subjects and quoting -------------------------------------------------

export function normalizeSubject(subject: string) {
  return subject.replace(/^(\s*(re|fw|fwd|aw|sv|vs|antw)\s*(\[\d+\])?\s*:\s*)+/i, "").trim();
}

export const replySubject = (subject: string) => `Re: ${normalizeSubject(subject)}`.trim();
export const forwardSubject = (subject: string) => `Fwd: ${normalizeSubject(subject)}`.trim();

export function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The quoted original under a reply or forward, marked the way Gmail marks
 * its own (gmail_quote), which is what other clients look for to fold it.
 */
export function quoteMessage(message: Message, mode: "reply" | "forward") {
  const when = new Date(message.sent_at ?? message.received_at).toUTCString();
  const body =
    message.html ?? `<div style="white-space:pre-wrap">${escapeHtml(message.text ?? "")}</div>`;
  const head =
    mode === "forward"
      ? `---------- Forwarded message ---------<br>From: ${escapeHtml(formatAddress(message.from))}<br>Date: ${when}<br>Subject: ${escapeHtml(message.subject)}<br>To: ${escapeHtml((message.to ?? []).map(formatAddress).join(", "))}<br><br>`
      : `On ${when}, ${escapeHtml(displayName(message.from))} wrote:<br>`;
  return [
    "<br><br>",
    '<div class="gmail_quote">',
    `<div class="gmail_attr">${head}</div>`,
    mode === "forward"
      ? body
      : `<blockquote class="gmail_quote" style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">${body}</blockquote>`,
    "</div>",
  ].join("");
}

// ---- Formatting -----------------------------------------------------------

/** 14:05 today, 21 Sep this year, Sep 24 before that. */
const DAY = 86_400_000;
const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** A list timestamp: 20:22 today, Tue this week, 12 Nov this year, Nov 24 before. */
export function formatStamp(value: string, now = new Date()) {
  const date = new Date(value);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days <= 0) {
    return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (days < 7) return date.toLocaleDateString("en-GB", { weekday: "short" });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

/** A message's time: 20:22 today, 20 Nov, 20:22 this year, with the year before. */
export function formatWhen(value: string, now = new Date()) {
  const date = new Date(value);
  const time = date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (startOfDay(date) === startOfDay(now)) return time;
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${day}${year}, ${time}`;
}

/**
 * The day heading a thread sits under in the list: Today, Yesterday,
 * Earlier this week (weeks start on Monday), then the date itself.
 */
export function dayGroup(value: string, now = new Date()) {
  const date = new Date(value);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days <= (now.getDay() + 6) % 7) return "Earlier this week";
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const year = date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${weekday} ${day}${year}`;
}

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const attachmentUrl = (id: string, inline = false) =>
  `/api/app/attachments/${id}${inline ? "?inline=true" : ""}`;
