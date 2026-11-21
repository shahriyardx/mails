import { describe, expect, it } from "vitest";
import { documentTitle } from "./title";

describe("documentTitle", () => {
  it.each([
    ["Inbox", 3, "(3) Inbox · Mails"],
    ["Inbox", 0, "Inbox · Mails"],
    ["Starred", 12, "(12) Starred · Mails"],
    ["Domains", undefined, "Domains · Mails"],
  ])("%s with %s unread -> %s", (view, unread, want) => {
    expect(documentTitle(view, unread)).toBe(want);
  });
});
