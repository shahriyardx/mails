/** Formatting and SES thresholds for the metrics and overview pages. */

/**
 * Amazon's limits, not ours: SES reviews an account at a 5% bounce rate or
 * a 0.1% complaint rate, and may pause sending above them.
 */
export const SES_LIMITS = { bounce: 0.05, complaint: 0.001 } as const;

/** A 0..1 fraction as a percent; small rates keep two decimals. Null is "—". */
export function formatRate(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en", {
    style: "percent",
    maximumFractionDigits: value > 0 && value < 0.01 ? 2 : 1,
  }).format(value);
}

export function formatCount(value: number) {
  return new Intl.NumberFormat("en").format(value);
}

export type RateLevel = "ok" | "watch" | "over";

/** "watch" from half the SES limit, "over" at or past it. */
export function rateLevel(kind: keyof typeof SES_LIMITS, value: number | null | undefined) {
  if (value === null || value === undefined) return "ok";
  const limit = SES_LIMITS[kind];
  if (value >= limit) return "over";
  if (value >= limit / 2) return "watch";
  return "ok";
}

/** "20 Nov" from "2026-11-20", read as a UTC day (how the server buckets). */
export function formatDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * One day's bar, split so the parts add up to `sent`: delivered (minus
 * complaints), problems (bounces and complaints) and still in flight.
 * The server counts complained mail as delivered too.
 */
export function barSegments(day: {
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
}) {
  const problems = day.bounced + day.complained;
  const delivered = Math.max(0, day.delivered - day.complained);
  return { delivered, problems, pending: Math.max(0, day.sent - delivered - problems) };
}
