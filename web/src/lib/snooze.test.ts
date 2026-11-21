import { describe, expect, it } from "vitest";
import { snoozeLabel, snoozePresets, toLocalInput } from "./snooze";

// Local times: the presets follow the browser's own clock.
const local = (s: string) => new Date(s);

describe("snoozePresets", () => {
  it("in the morning: today 18:00, tomorrow 08:00, next Monday 08:00", () => {
    // Wednesday
    const [later, tomorrow, week] = snoozePresets(local("2026-11-18T09:30:00"));
    expect(toLocalInput(later!.at)).toBe("2026-11-18T18:00");
    expect(toLocalInput(tomorrow!.at)).toBe("2026-11-19T08:00");
    expect(toLocalInput(week!.at)).toBe("2026-11-23T08:00");
  });

  it("late in the day, later today is three hours on", () => {
    const [later] = snoozePresets(local("2026-11-18T17:30:00"));
    expect(toLocalInput(later!.at)).toBe("2026-11-18T20:30");
  });

  it("on a Monday, next week is the Monday after", () => {
    const week = snoozePresets(local("2026-11-23T10:00:00"))[2]!;
    expect(toLocalInput(week.at)).toBe("2026-11-30T08:00");
  });

  it("on a Sunday, next week is the next day", () => {
    const week = snoozePresets(local("2026-11-22T10:00:00"))[2]!;
    expect(toLocalInput(week.at)).toBe("2026-11-23T08:00");
  });

  it("every preset is in the future", () => {
    for (const hour of [0, 6, 12, 17, 23]) {
      const now = local(`2026-11-18T${String(hour).padStart(2, "0")}:59:00`);
      for (const p of snoozePresets(now)) expect(p.at.getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe("snoozeLabel", () => {
  it("shows only the time for today", () => {
    const now = local("2026-11-18T09:00:00");
    expect(snoozeLabel(local("2026-11-18T18:00:00"), now)).toBe("18:00");
    expect(snoozeLabel(local("2026-11-19T08:00:00"), now)).toMatch(/08:00$/);
  });
});
