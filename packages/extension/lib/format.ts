import type { Address, ApiThread } from "./types";

/**
 * The small presentational decisions, kept out of the components.
 *
 * The avatar hue, the initials rule and the day groups are copies of
 * web/src/components/kit/avatar.tsx and web/src/lib/mail.ts on purpose: the
 * same sender must look the same in the toolbar as in the tab next to it.
 */

/** A stable hue (0-359) for an address, so a person keeps their colour. */
export function hueFor(key: string) {
  let hash = 0;
  for (const char of key.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

/** "Ada Lovelace" -> AL; a single word or a bare address gives one letter. */
export function initialsFor(name?: string | null, address?: string | null) {
  const words = (name ?? "").replace(/[<>"]/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length > 1)
    return ((words[0] as string)[0]! + (words.at(-1) as string)[0]!).toUpperCase();
  return (words[0] ?? address ?? "?").slice(0, 1).toUpperCase();
}

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

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

/** A person, as short as it can be while still naming them. */
export function displayName(entry: Address | null | undefined) {
  if (!entry) return "Unknown";
  return entry.name?.trim() || entry.address.split("@")[0] || entry.address;
}

export function formatAddress(entry: Address) {
  return entry.name?.trim() ? `${entry.name} <${entry.address}>` : entry.address;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A timestamp the way a mail client writes one: a clock time today, a weekday
 * this week, a date before that. Never "3 days ago", which asks the reader to
 * do arithmetic to find out when something actually happened.
 */
export function shortTime(value: string | Date, now = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";

  const gap = now.getTime() - date.getTime();

  if (gap < MINUTE) return "now";
  if (gap < HOUR) return `${Math.floor(gap / MINUTE)}m`;
  if (sameDay(date, now)) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (gap < 6 * DAY) return date.toLocaleDateString(undefined, { weekday: "short" });
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" });
}

/** The long form, for a message header and a tooltip. */
export function fullTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Who a row is about.
 *
 * In the inbox that is whoever wrote in; in Sent it is who it went to. Using
 * the participant list either way would label every sent message with your
 * own address, which tells the reader nothing.
 */
export function rowPerson(thread: ApiThread, view: string): Address {
  const own = (thread.mailbox ?? "").toLowerCase();
  const people = thread.participants ?? [];
  const others = people.filter((p) => p.address.toLowerCase() !== own);
  const chosen = view === "sent" ? others[others.length - 1] : others[0];
  return chosen ?? people[0] ?? { name: null, address: thread.mailbox ?? "unknown" };
}

export function threadSubject(thread: ApiThread) {
  return thread.subject?.trim() || "(no subject)";
}

/** Joins class names, skipping anything falsy. Small enough not to be a dep. */
export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
