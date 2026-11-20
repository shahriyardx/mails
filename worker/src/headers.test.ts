import { describe, expect, it } from "vitest";
import { parseCloudflareResults, readAuth } from "./headers";

const headers = (pairs: [string, string][]) => pairs.map(([key, value]) => ({ key, value }));

const ENVELOPE = "0101019-bounces@us-west-2-amazonses.npmjs.com";
const CF_RECEIVED: [string, string] = [
  "Received",
  "from a8-96.smtp-out.amazonses.com (a8-96.smtp-out.amazonses.com [54.240.8.96]) by mx.cloudflare.net with ESMTPS id abc123 (version=TLS1_3 cipher=TLS_AES_128_GCM_SHA256) for <contact@ccbot.app>; Sun, 21 Sep 2026 17:56:21 +0000",
];
const CF_AUTH: [string, string] = [
  "Authentication-Results",
  `mx.cloudflare.net;\r\n\tdkim=pass header.d=amazonses.com header.s=224i4yxa header.b=Ab+/9=;\r\n\tdkim=pass header.d=npmjs.com header.s=s1;\r\n\tdmarc=pass header.from=npmjs.com policy.dmarc=none;\r\n\tspf=pass (mx.cloudflare.net: domain of ${ENVELOPE} designates 54.240.8.96 as permitted sender; ok) smtp.mailfrom=${ENVELOPE};\r\n\tarc=none smtp.remote-ip=54.240.8.96`,
];
const FORGED: [string, string] = [
  "Authentication-Results",
  "mx.cloudflare.net; spf=pass smtp.mailfrom=ceo@bank.com; dkim=pass header.d=bank.com; dmarc=pass",
];

/** A real-shaped npm receipt: Cloudflare's headers on top, the sender's below. */
const npm = headers([
  CF_RECEIVED,
  CF_AUTH,
  ["Return-Path", "<attacker@evil.com>"],
  ["DKIM-Signature", "v=1; a=rsa-sha256; d=npmjs.com; s=s1"],
]);

const on = { trusted: true, envelopeFrom: ENVELOPE, fromAddress: "support@npmjs.com" };
const NULLS = {
  auth: { spf: null, dkim: null, dmarc: null },
  mailedBy: null,
  signedBy: null,
  tls: null,
};
const only = (value: string) => headers([["Authentication-Results", value]]);

describe("trust", () => {
  it("reads Cloudflare's header when the deployment trusts it", () => {
    expect(readAuth(npm, on)).toEqual({
      auth: { spf: "pass", dkim: "pass", dmarc: "pass" },
      mailedBy: "us-west-2-amazonses.npmjs.com",
      signedBy: "npmjs.com",
      tls: "TLS1.3",
    });
  });

  it("reports nothing unless trust is turned on (Cloudflare's header may be absent)", () => {
    expect(readAuth(npm, { ...on, trusted: false })).toEqual(NULLS);
    expect(readAuth(headers([FORGED]), { ...on, trusted: false })).toEqual(NULLS);
  });

  it("ignores a forged header below the real one", () => {
    const real = headers([
      ["Authentication-Results", "mx.cloudflare.net; spf=fail smtp.mailfrom=ceo@bank.com; dkim=none; dmarc=fail"],
      FORGED,
    ]);
    expect(readAuth(real, { ...on, envelopeFrom: "ceo@bank.com", fromAddress: "ceo@bank.com" })).toEqual({
      ...NULLS,
      auth: { spf: "fail", dkim: "none", dmarc: "fail" },
    });
  });

  it("never falls back to a lower header when the topmost is not Cloudflare's", () => {
    const relayed = headers([["Authentication-Results", "mx.google.com; spf=pass; dkim=pass; dmarc=pass"], FORGED]);
    expect(readAuth(relayed, on)).toEqual(NULLS);
  });

  it("never falls back when the topmost Cloudflare header is malformed", () => {
    expect(readAuth(headers([["Authentication-Results", "mx.cloudflare.net; dkim=pass ("], FORGED]), on)).toEqual(NULLS);
  });

  it("returns nulls when there is no header", () => {
    expect(readAuth(headers([CF_RECEIVED]), on)).toEqual(NULLS);
  });
});

describe("authserv-id", () => {
  it.each([
    "mx.cloudflare.net.evil.com",
    "evil-mx.cloudflare.net",
    "cloudflare",
    "x (mx.cloudflare.net)",
    "spf=pass mx.cloudflare.net",
    "mx.cloudflare.net extra",
    "mx.cloudflare.net 1 2",
    "",
  ])("rejects %j", (id) => {
    expect(parseCloudflareResults(`${id}; spf=pass; dkim=pass; dmarc=pass`)).toBeNull();
  });

  it("allows a comment before and a version after, any case", () => {
    expect(parseCloudflareResults("(cf) MX.Cloudflare.NET 1; dmarc=pass")).toEqual([
      { method: "dmarc", verdict: "pass", props: {} },
    ]);
  });

  it("reads 'none' as no results", () => {
    expect(parseCloudflareResults("mx.cloudflare.net; none")).toEqual([]);
  });
});

describe("strict RFC 8601 parsing", () => {
  it("does not split on a ';' inside a comment, even with an escaped paren", () => {
    const value = "mx.cloudflare.net; dmarc=fail (a \\) ; dkim=pass header.d=bank.com) header.from=bank.com";
    expect(parseCloudflareResults(value)).toEqual([
      { method: "dmarc", verdict: "fail", props: { "header.from": "bank.com" } },
    ]);
  });

  it("does not split on a ';' inside a quoted local part", () => {
    const value = 'mx.cloudflare.net; spf=fail smtp.mailfrom="x;dkim=pass header.d=bank.com"@evil.com';
    const results = parseCloudflareResults(value);
    expect(results).toHaveLength(1);
    expect(results?.[0]?.method).toBe("spf");
  });

  it("never reads a method inside a property value", () => {
    expect(parseCloudflareResults("mx.cloudflare.net; dmarc=fail header.from=spf=pass")).toEqual([
      { method: "dmarc", verdict: "fail", props: { "header.from": "spf=pass" } },
    ]);
  });

  it("ignores '=' and verdict text inside comments", () => {
    expect(parseCloudflareResults("mx.cloudflare.net; dkim=fail (dkim=pass header.d=bank.com)")).toEqual([
      { method: "dkim", verdict: "fail", props: {} },
    ]);
  });

  it.each([
    ["junk segment", "mx.cloudflare.net; spf=pass smtp.mailfrom=a; dkim=pass@evil.com"],
    ["unknown result", "mx.cloudflare.net; dkim=great"],
    ["text after the result", "mx.cloudflare.net; dkim=pass because i said so"],
    ["unknown ptype", "mx.cloudflare.net; dkim=pass evil.d=bank.com"],
    ["empty middle segment", "mx.cloudflare.net; ; dkim=pass"],
    ["unbalanced comment", "mx.cloudflare.net; dkim=pass (oops"],
    ["stray close paren", "mx.cloudflare.net; dkim=pass ) x"],
    ["unterminated quote", 'mx.cloudflare.net; spf=pass smtp.mailfrom="a'],
  ])("rejects the whole header on %s", (_, value) => {
    expect(parseCloudflareResults(value)).toBeNull();
  });

  it("unfolds CRLF continuations", () => {
    expect(parseCloudflareResults("mx.cloudflare.net;\r\n dkim=pass\r\n\theader.d=a.com")).toEqual([
      { method: "dkim", verdict: "pass", props: { "header.d": "a.com" } },
    ]);
  });

  it("accepts method versions and a trailing ';'", () => {
    expect(parseCloudflareResults("mx.cloudflare.net; dkim/1=pass header.i=@a.com;")).toEqual([
      { method: "dkim", verdict: "pass", props: { "header.i": "@a.com" } },
    ]);
  });
});

describe("verdicts", () => {
  it("nulls a duplicated dmarc that disagrees", () => {
    expect(readAuth(only("mx.cloudflare.net; dmarc=fail; dmarc=pass"), on).auth.dmarc).toBeNull();
  });

  it("nulls disagreeing smtp.mailfrom SPF checks, and ignores the HELO check", () => {
    const value = `mx.cloudflare.net; spf=pass smtp.mailfrom=${ENVELOPE}; spf=fail smtp.mailfrom=${ENVELOPE}; spf=pass smtp.helo=x`;
    expect(readAuth(only(value), on).auth.spf).toBeNull();
    expect(readAuth(only(`mx.cloudflare.net; spf=none smtp.helo=x; spf=fail smtp.mailfrom=${ENVELOPE}`), on).auth.spf).toBe("fail");
  });
});

describe("mailed-by", () => {
  it("is null unless SPF passed for the envelope sender's domain", () => {
    expect(readAuth(only(`mx.cloudflare.net; spf=fail smtp.mailfrom=${ENVELOPE}`), on).mailedBy).toBeNull();
    expect(readAuth(only("mx.cloudflare.net; spf=pass smtp.mailfrom=x@other.com"), on).mailedBy).toBeNull();
    expect(readAuth(only(`mx.cloudflare.net; spf=pass smtp.mailfrom=${ENVELOPE}`), { ...on, envelopeFrom: "" }).mailedBy).toBeNull();
  });

  it("never reads Return-Path", () => {
    expect(readAuth(headers([["Return-Path", "<a@bank.com>"]]), on).mailedBy).toBeNull();
  });
});

describe("signed-by", () => {
  it("prefers the verified signature aligned with From, else the relay", () => {
    expect(readAuth(npm, on).signedBy).toBe("npmjs.com");
    expect(readAuth(npm, { ...on, fromAddress: "news@brand.com" }).signedBy).toBe("amazonses.com");
  });

  it("falls back to the domain of header.i", () => {
    const value = "mx.cloudflare.net; dkim=pass header.i=@github.com";
    expect(readAuth(only(value), { ...on, fromAddress: "noreply@notifications.github.com" }).signedBy).toBe("github.com");
  });

  it("ignores failed and unverified signatures", () => {
    const unsigned = headers([
      ["Authentication-Results", "mx.cloudflare.net; dkim=fail header.d=paypal.com; dmarc=fail"],
      ["DKIM-Signature", "v=1; d=paypal.com; s=x"],
    ]);
    expect(readAuth(unsigned, on).signedBy).toBeNull();
    expect(readAuth(headers([["DKIM-Signature", "v=1; d=paypal.com"]]), on).signedBy).toBeNull();
  });
});

describe("tls", () => {
  const withReceived = (received: string) =>
    headers([["Received", received], ["Authentication-Results", "mx.cloudflare.net; none"]]);

  it("calls a plaintext hop what it is, and settles for ESMTPS", () => {
    expect(readAuth(withReceived("from a by mx.cloudflare.net with ESMTP id x1"), on).tls).toBe("none");
    expect(readAuth(withReceived("from a by mx.cloudflare.net with ESMTPS id x1"), on).tls).toBe("TLS");
  });

  it("does not read a version the sender put in its HELO name", () => {
    expect(readAuth(withReceived("from version=TLS1_3 (x [1.2.3.4]) by mx.cloudflare.net with ESMTP id x1"), on).tls).toBe("none");
  });

  it("is null when the topmost hop is not Cloudflare, or trust is off", () => {
    expect(readAuth(withReceived("from x by mail.evil.com with ESMTPS (version=TLS1_3)"), on).tls).toBeNull();
    expect(readAuth(npm, { ...on, trusted: false }).tls).toBeNull();
  });
});
