import { describe, expect, it } from "vitest";
import { describeBrowser, urlBase64ToUint8Array } from "./push";
import {
  canUseOwnDkim,
  describeFilter,
  domainChecks,
  domainSummary,
  emptyFilterForm,
  formFromFilter,
  nestDomains,
  receivingNote,
  relativeName,
  validateFilter,
} from "./settings";
import type { Domain, Filter } from "./types";

function domain(over: Partial<Domain> = {}): Domain {
  return {
    object: "domain",
    id: "dom_1",
    name: "example.com",
    region: "us-east-1",
    status: "verified",
    sending_enabled: true,
    dkim_status: "verified",
    dkim_origin: null,
    mail_from_domain: "mail.example.com",
    mail_from_status: "verified",
    spf_verified: true,
    dmarc_verified: false,
    inherited_from: null,
    auto_create_mailboxes: false,
    forward_off: false,
    imported: false,
    last_checked_at: null,
    created_at: "2026-11-20T00:00:00Z",
    records: [],
    ...over,
  };
}

describe("relativeName", () => {
  it.each([
    ["example.com", "example.com", "@"],
    ["_dmarc.example.com", "example.com", "_dmarc"],
    ["a._domainkey.example.com", "example.com", "a._domainkey"],
    ["mail.example.com.", "Example.com", "mail"],
    ["notexample.com", "example.com", "notexample.com"],
    ["other.org", "example.com", "other.org"],
  ])("%s in %s is %s", (name, zone, want) => {
    expect(relativeName(name, zone)).toBe(want);
  });
});

describe("nestDomains", () => {
  it("puts inherited subdomains under their parent, sorted", () => {
    const list = [
      domain({ id: "3", name: "z.example.com", inherited_from: "example.com" }),
      domain({ id: "2", name: "b.org" }),
      domain({ id: "1", name: "example.com" }),
      domain({ id: "4", name: "a.example.com", inherited_from: "example.com" }),
      domain({ id: "5", name: "x.gone.net", inherited_from: "gone.net" }),
    ];
    const nested = nestDomains(list);
    expect(nested.map((n) => n.domain.name)).toEqual(["b.org", "example.com", "x.gone.net"]);
    expect(nested[1]?.children.map((c) => c.name)).toEqual(["a.example.com", "z.example.com"]);
  });
});

describe("domain status", () => {
  it("lists checks; inherited has none", () => {
    expect(domainChecks(domain()).map((c) => c.key)).toEqual(["dkim", "mail-from", "spf", "dmarc"]);
    expect(domainChecks(domain({ mail_from_domain: null })).map((c) => c.key)).not.toContain(
      "mail-from",
    );
    expect(domainChecks(domain({ inherited_from: "example.com" }))).toEqual([]);
  });

  it("summarises", () => {
    expect(domainSummary(domain())).toMatchObject({ ready: true, text: "Ready" });
    expect(domainSummary(domain({ inherited_from: "x.com" })).text).toBe("No setup needed");
    expect(domainSummary(domain({ status: "pending", dkim_status: "pending" })).text).toBe(
      "Pending · DKIM pending",
    );
    expect(domainSummary(domain({ status: "failed" }))).toMatchObject({
      danger: true,
      text: "Failed",
    });
    expect(domainSummary(domain({ sending_enabled: false })).text).toBe("Sending paused in SES");
  });

  it("offers one TXT record only for SES's CNAMEs", () => {
    const cname = {
      kind: "CNAME" as const,
      name: "a",
      value: "v",
      purpose: "DKIM signing",
      required: true,
    };
    const three = [cname, cname, cname];
    expect(canUseOwnDkim(domain({ records: three }))).toBe(true);
    expect(canUseOwnDkim(domain({ records: three, dkim_origin: "EXTERNAL" }))).toBe(false);
    expect(canUseOwnDkim(domain({ records: [] }))).toBe(false);
  });
});

describe("receivingNote", () => {
  it("explains each state", () => {
    expect(receivingNote(undefined)).toBeNull();
    expect(receivingNote({ state: "published", domain: "s.x.com", zone: "x.com" })?.text).toContain(
      "s.x.com",
    );
    expect(receivingNote({ state: "already" })?.ok).toBe(true);
    const skipped = receivingNote({ state: "skipped", reason: "No Cloudflare token is connected" });
    expect(skipped?.ok).toBe(false);
    expect(skipped?.text).toContain("No Cloudflare token");
  });
});

describe("validateFilter", () => {
  const good = {
    ...emptyFilterForm,
    name: " News ",
    match_from: " @substack.com ",
    action_folder: "archive" as const,
  };

  it("builds the request body, trimming and nulling empties", () => {
    const { input, errors } = validateFilter(good);
    expect(errors).toEqual({});
    expect(input).toEqual({
      name: "News",
      enabled: true,
      priority: 0,
      match_from: "@substack.com",
      match_to: null,
      match_subject: null,
      match_body: null,
      action_folder: "archive",
      action_label_id: null,
      action_mark_read: false,
      action_star: false,
    });
  });

  it("needs a name, a condition and an action", () => {
    const { input, errors } = validateFilter(emptyFilterForm);
    expect(input).toBeUndefined();
    expect(Object.keys(errors).sort()).toEqual(["action", "match", "name"]);
  });

  it("checks priority and lengths", () => {
    expect(validateFilter({ ...good, priority: "1.5" }).errors.priority).toBeTruthy();
    expect(validateFilter({ ...good, priority: "-3" }).input?.priority).toBe(-3);
    expect(validateFilter({ ...good, priority: "" }).input?.priority).toBe(0);
    expect(validateFilter({ ...good, name: "x".repeat(101) }).errors.name).toBeTruthy();
    expect(validateFilter({ ...good, match_body: "x".repeat(501) }).errors.match).toBeTruthy();
  });

  it("accepts a label or a flag as the action", () => {
    expect(validateFilter({ ...good, action_folder: "", action_star: true }).input).toBeTruthy();
    expect(
      validateFilter({ ...good, action_folder: "", action_label_id: "lbl_1" }).input
        ?.action_label_id,
    ).toBe("lbl_1");
  });

  it("round-trips a saved filter", () => {
    const saved: Filter = {
      id: "flt_1",
      created_at: "",
      ...validateFilter({ ...good, match_subject: "invoice", action_mark_read: true }).input!,
    };
    expect(validateFilter(formFromFilter(saved)).input).toMatchObject({
      match_subject: "invoice",
      action_mark_read: true,
    });
    expect(
      describeFilter(saved, [{ object: "label", id: "x", name: "N", color: "", created_at: "" }]),
    ).toBe('From has "@substack.com", Subject has "invoice" → Archive, mark read');
  });
});

describe("push helpers", () => {
  it("decodes a base64url VAPID key", () => {
    expect([...urlBase64ToUint8Array("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
  });

  it("names a browser", () => {
    expect(
      describeBrowser("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"),
    ).toBe("Firefox on Linux");
    expect(
      describeBrowser(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome on Android");
    expect(
      describeBrowser(
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130",
      ),
    ).toBe("Edge on Windows");
    expect(describeBrowser("curl/8")).toBe("A browser");
  });
});
