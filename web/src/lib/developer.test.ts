import { describe, expect, it } from "vitest";
import { calloutKind, docFile, docHref, docPathFromUrl, linkKind, neighbours } from "./docs";
import { barSegments, formatDay, formatRate, rateLevel } from "./reports";
import {
  CUSTOM,
  describeReach,
  describeScopes,
  everyScope,
  initialScopes,
  levelOf,
  nextScopes,
  reachBody,
  reachReady,
  type ScopeCatalog,
  toggleId,
} from "./scopes";
import type { Mailbox, ScopeArea } from "./types";

const area = (id: string, read: string, write?: string): ScopeArea => ({
  id,
  label: id[0]!.toUpperCase() + id.slice(1),
  hint: "",
  levels: [
    { label: "None", scopes: [] },
    { label: "Read", scopes: [read] },
    ...(write ? [{ label: "Manage", scopes: [read, write] }] : []),
  ],
});

const catalog: ScopeCatalog = {
  areas: [area("mail", "mail:read", "mail:write"), area("stats", "stats:read")],
  presets: [
    { id: "full", label: "Full access", hint: "", scopes: ["*"] },
    { id: "read", label: "Read only", hint: "", scopes: ["mail:read", "stats:read"] },
  ],
};

describe("scopes", () => {
  it("reads the level an area reaches", () => {
    const mail = catalog.areas[0]!;
    expect(levelOf(mail, [])).toBe(0);
    expect(levelOf(mail, ["mail:read"])).toBe(1);
    expect(levelOf(mail, ["mail:read", "mail:write"])).toBe(2);
    expect(levelOf(mail, ["*"])).toBe(2);
  });

  it("describes scopes in words", () => {
    expect(describeScopes(catalog.areas, ["*"])).toBe("Full access");
    expect(describeScopes(catalog.areas, [])).toBe("No access");
    expect(describeScopes(catalog.areas, ["mail:read", "mail:write", "stats:read"])).toBe(
      "Mail · Stats (read)",
    );
  });

  it("starts on the first preset", () => {
    expect(initialScopes(catalog)).toEqual({ preset: "full", scopes: ["*"] });
  });

  it("copies a preset's scopes", () => {
    const next = nextScopes(initialScopes(catalog), { type: "preset", id: "read" }, catalog);
    expect(next).toEqual({ preset: "read", scopes: ["mail:read", "stats:read"] });
  });

  it("writes out the wildcard when moving to custom", () => {
    const next = nextScopes(initialScopes(catalog), { type: "preset", id: CUSTOM }, catalog);
    expect(next.preset).toBe(CUSTOM);
    expect(next.scopes.sort()).toEqual(everyScope(catalog.areas).sort());
    expect(next.scopes).not.toContain("*");
  });

  it("keeps the scopes when moving to custom from a named preset", () => {
    const read = { preset: "read", scopes: ["mail:read", "stats:read"] };
    expect(nextScopes(read, { type: "preset", id: CUSTOM }, catalog)).toEqual({
      preset: CUSTOM,
      scopes: read.scopes,
    });
  });

  it("changes one area and names the matching preset", () => {
    const custom = { preset: CUSTOM, scopes: ["mail:read", "mail:write", "stats:read"] };
    const lowered = nextScopes(custom, { type: "level", area: "mail", level: 1 }, catalog);
    expect(lowered).toEqual({ preset: "read", scopes: ["mail:read", "stats:read"] });
    const none = nextScopes(lowered, { type: "level", area: "stats", level: 0 }, catalog);
    expect(none).toEqual({ preset: CUSTOM, scopes: ["mail:read"] });
  });

  it("ignores an unknown preset", () => {
    const state = initialScopes(catalog);
    expect(nextScopes(state, { type: "preset", id: "nope" }, catalog)).toBe(state);
  });
});

describe("reach", () => {
  it("sends domains or mailboxes, never both", () => {
    expect(reachBody({ mode: "all" })).toEqual({ domains: [], mailboxes: [] });
    expect(reachBody({ mode: "domains", ids: ["dom_1"] })).toEqual({
      domains: ["dom_1"],
      mailboxes: [],
    });
    expect(reachBody({ mode: "mailboxes", ids: ["mbx_1"] })).toEqual({
      domains: [],
      mailboxes: ["mbx_1"],
    });
  });

  it("is not ready while narrowed to nothing", () => {
    expect(reachReady({ mode: "all" })).toBe(true);
    expect(reachReady({ mode: "domains", ids: [] })).toBe(false);
    expect(reachReady({ mode: "mailboxes", ids: ["mbx_1"] })).toBe(true);
  });

  it("toggles ids without duplicates", () => {
    expect(toggleId(["a"], "a", true)).toEqual(["a"]);
    expect(toggleId(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleId(["a", "b"], "a", false)).toEqual(["b"]);
  });

  it("describes reach in one line", () => {
    const boxes = [
      { id: "m1", address: "a@x.com" },
      { id: "m2", address: "b@x.com" },
      { id: "m3", address: "c@x.com" },
      { id: "m4", address: "d@x.com" },
    ] as Mailbox[];
    const domains = [{ id: "d1", name: "x.com" }];
    expect(describeReach({ domains: null, mailboxes: null }, domains, boxes)).toBe("Every mailbox");
    expect(describeReach({ domains: ["d1"], mailboxes: [] }, domains, boxes)).toBe("all of x.com");
    expect(describeReach({ domains: [], mailboxes: ["m1", "m2"] }, domains, boxes)).toBe(
      "a@x.com, b@x.com",
    );
    expect(
      describeReach({ domains: [], mailboxes: ["m1", "m2", "m3", "m4"] }, domains, boxes),
    ).toBe("a@x.com, b@x.com and 2 more");
  });
});

describe("reports", () => {
  it("formats rates", () => {
    expect(formatRate(null)).toBe("—");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(0.0008)).toBe("0.08%");
    expect(formatRate(0.042)).toBe("4.2%");
    expect(formatRate(0.996)).toBe("99.6%");
    expect(formatRate(1)).toBe("100%");
  });

  it("grades rates against the SES limits", () => {
    expect(rateLevel("bounce", null)).toBe("ok");
    expect(rateLevel("bounce", 0.01)).toBe("ok");
    expect(rateLevel("bounce", 0.03)).toBe("watch");
    expect(rateLevel("bounce", 0.05)).toBe("over");
    expect(rateLevel("complaint", 0.0004)).toBe("ok");
    expect(rateLevel("complaint", 0.0005)).toBe("watch");
    expect(rateLevel("complaint", 0.002)).toBe("over");
  });

  it("formats a UTC day", () => {
    expect(formatDay("2026-11-20")).toBe("20 Nov");
  });

  it("splits a day's bar so the parts add up to sent", () => {
    const day = { sent: 10, delivered: 7, bounced: 1, complained: 1 };
    expect(barSegments(day)).toEqual({ delivered: 6, problems: 2, pending: 2 });
    const empty = { sent: 0, delivered: 0, bounced: 0, complained: 0 };
    expect(barSegments(empty)).toEqual({ delivered: 0, problems: 0, pending: 0 });
  });
});

describe("docs", () => {
  const files = new Set(["index.md", "api/index.md", "api/emails.md", "guide/index.md"]);

  it("maps URLs to doc paths", () => {
    expect(docPathFromUrl("/docs")).toBe("index");
    expect(docPathFromUrl("/docs/")).toBe("index");
    expect(docPathFromUrl("/docs/api/index")).toBe("api/index");
    expect(docPathFromUrl("/docs/api/emails/")).toBe("api/emails");
    expect(docPathFromUrl("/docs/api/emails.md")).toBe("api/emails");
  });

  it("maps doc paths to files", () => {
    expect(docFile("index", files)).toBe("index.md");
    expect(docFile("api/index", files)).toBe("api/index.md");
    expect(docFile("api", files)).toBe("api/index.md");
    expect(docFile("api/emails", files)).toBe("api/emails.md");
    expect(docFile("api/nope", files)).toBeNull();
    expect(docFile("../secrets", files)).toBeNull();
  });

  it("builds hrefs", () => {
    expect(docHref("index")).toBe("/docs");
    expect(docHref("api/index")).toBe("/docs/api/index");
  });

  it("sorts links", () => {
    expect(linkKind("#reach")).toBe("hash");
    expect(linkKind("/docs/api/scopes#reach")).toBe("internal");
    expect(linkKind("/settings/api-keys")).toBe("internal");
    expect(linkKind("//evil.example")).toBe("external");
    expect(linkKind("https://aws.amazon.com/ses/")).toBe("external");
  });

  it("finds callouts", () => {
    const quote = (label: string) => ({
      type: "element",
      tagName: "blockquote",
      children: [
        { type: "text", value: "\n" },
        {
          type: "element",
          tagName: "p",
          children: [
            { type: "element", tagName: "strong", children: [{ type: "text", value: label }] },
            { type: "text", value: " body" },
          ],
        },
      ],
    });
    expect(calloutKind(quote("Tip:"))).toBe("tip");
    expect(calloutKind(quote("Warning:"))).toBe("warning");
    expect(calloutKind(quote("Danger:"))).toBe("danger");
    expect(calloutKind(quote("Note:"))).toBeNull();
    expect(calloutKind(undefined)).toBeNull();
  });

  it("finds neighbours in nav order", () => {
    const nav = [
      { title: "A", pages: [{ path: "index", title: "Home" }] },
      { title: "B", pages: [{ path: "api/index", title: "API" }] },
    ];
    expect(neighbours(nav, "index").next?.path).toBe("api/index");
    expect(neighbours(nav, "api/index").prev?.path).toBe("index");
    expect(neighbours(nav, "missing")).toEqual({});
  });
});
