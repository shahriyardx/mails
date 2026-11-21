import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSearch, termLabel, withoutTerm } from "./search";

// The same cases the server's parser is tested with.
const cases: { q: string; terms: { op: string; value: string }[]; text: string }[] = JSON.parse(
  readFileSync(new URL("../../../internal/mail/testdata/search.json", import.meta.url), "utf8"),
);

describe("parseSearch", () => {
  it.each(cases)("$q", ({ q, terms, text }) => {
    const got = parseSearch(q);
    expect(got.terms.map(({ op, value }) => ({ op, value }))).toEqual(terms);
    expect(got.text).toBe(text);
  });
});

describe("withoutTerm", () => {
  it("drops one filter and keeps the rest as typed", () => {
    expect(withoutTerm('from:"Ada L" report is:unread', 0)).toBe("is:unread report");
    expect(withoutTerm("is:unread", 0)).toBe("");
  });
});

describe("termLabel", () => {
  it("reads like the filter", () => {
    expect(termLabel({ op: "from", value: "Ada L", raw: "" })).toBe("from: Ada L");
    expect(termLabel({ op: "has", value: "attachment", raw: "" })).toBe("has attachment");
  });
});
