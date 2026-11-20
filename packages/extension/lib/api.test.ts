import { describe, expect, it } from "vitest";
import { canReadMail } from "./api";

describe("canReadMail", () => {
  it.each([
    [["*"], true],
    [["mail:read"], true],
    [["mail:write"], true],
    [["emails:send", "mail:read"], true],
    [[], false],
    [["mailboxes:read"], false],
    [["emails:send", "emails:read"], false],
  ])("%j -> %s", (scopes, want) => {
    expect(canReadMail(scopes)).toBe(want);
  });
});
