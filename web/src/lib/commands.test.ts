import { describe, expect, it } from "vitest";
import { type Command, matchScore, rankCommands } from "./commands";

describe("matchScore", () => {
  it.each([
    ["Inbox", "inbox", 100],
    ["Inbox", "in", 80],
    ["API keys", "keys", 60],
    ["hello@example.com", "example", 60],
    ["Webhooks", "hook", 40],
    ["Blocked addresses", "bad", 13], // b..a..d, 7 letters skipped
    ["Settings Domains", "set dom", 15],
    ["Inbox", "xyz", 0],
    ["Inbox", "bi", 0], // letters out of order
    ["Inbox", "  ", 1],
  ])("%s / %s -> %i", (text, query, want) => {
    expect(matchScore(text, query)).toBe(want);
  });

  it("scores tighter fuzzy matches higher", () => {
    expect(matchScore("forwarding", "fwd")).toBeGreaterThan(matchScore("f a w a d", "fwd"));
  });
});

const cmd = (label: string, hint = "Folder", keywords?: string): Command => ({
  id: label,
  label,
  hint,
  icon: "inbox",
  keywords,
  run: () => {},
});

describe("rankCommands", () => {
  const all = [
    cmd("Inbox"),
    cmd("Starred"),
    cmd("Sent"),
    cmd("Spam"),
    cmd("Domains", "Settings"),
    cmd("Mailboxes", "Settings"),
    cmd("Write message", "Action", "compose new email"),
    cmd("sales@example.com", "Mailbox"),
  ];
  const labels = (query: string) => rankCommands(all, query).map((c) => c.label);

  it("keeps every command, in order, for an empty query", () => {
    expect(labels("")).toEqual(all.map((c) => c.label));
  });

  it("puts prefix matches first and drops what does not match", () => {
    expect(labels("s")[0]).toBe("Starred");
    expect(labels("spa")).toEqual(["Spam"]);
  });

  it("ranks label matches above kind and keyword matches", () => {
    expect(labels("mail")).toEqual(["Mailboxes", "Write message", "sales@example.com"]);
  });

  it("finds commands by kind and keywords, below label matches", () => {
    expect(labels("compose")).toEqual(["Write message"]);
    expect(labels("settings")).toEqual(["Domains", "Mailboxes"]);
    expect(labels("set dom")).toEqual(["Domains"]);
  });

  it("matches letters in order (fuzzy)", () => {
    expect(labels("strd")).toEqual(["Starred"]);
  });
});
