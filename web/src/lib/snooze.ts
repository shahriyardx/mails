/**
 * Snooze times, in the browser's own time zone. The server gets the
 * absolute moment (toISOString, UTC).
 */

export interface SnoozePreset {
  label: string;
  at: Date;
}

function at(day: Date, hour: number, addDays = 0) {
  const d = new Date(day);
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/**
 * Later today (18:00, or in 3 hours once that is near or past), tomorrow
 * 08:00, and next week (Monday 08:00).
 */
export function snoozePresets(now: Date): SnoozePreset[] {
  const evening = at(now, 18);
  const later =
    evening.getTime() - now.getTime() >= 60 * 60 * 1000
      ? evening
      : new Date(now.getTime() + 3 * 60 * 60 * 1000);
  // Days until next Monday: 1..7 (a Monday goes to the one after).
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return [
    { label: "Later today", at: later },
    { label: "Tomorrow", at: at(now, 8, 1) },
    { label: "Next week", at: at(now, 8, toMonday) },
  ];
}

/** "Tue 08:00", or "18:00" today. */
export function snoozeLabel(when: Date, now = new Date()): string {
  const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (when.toDateString() === now.toDateString()) return time;
  const day =
    when.getTime() - now.getTime() < 6 * 24 * 60 * 60 * 1000
      ? when.toLocaleDateString([], { weekday: "short" })
      : when.toLocaleDateString([], { day: "numeric", month: "short" });
  return `${day} ${time}`;
}

/** A datetime-local input's value (local time) for `d`. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
