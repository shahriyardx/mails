/**
 * Reading the authentication headers of an inbound message.
 *
 * Kept apart from the worker entry point so it can be exercised against real
 * headers without standing up a Cloudflare runtime.
 *
 * Trust rule: every header in the message may have been written by the
 * sender. Only an Authentication-Results header prepended by Cloudflare is a
 * verdict, and nothing in the message can prove Cloudflare wrote it: when
 * Cloudflare does not stamp one (reported for Worker deliveries, see
 * cloudflare/workerd#6740), a sender's forged "mx.cloudflare.net; dkim=pass"
 * would be the topmost. So:
 *
 * - Trust is off unless the deployment turns it on (TRUST_AUTH_RESULTS =
 *   "true"), after checking that its zone stamps every message.
 * - When on, only the topmost Authentication-Results is read, only when its
 *   authserv-id is exactly Cloudflare's, and only when it parses strictly per
 *   RFC 8601. Anything else yields nulls. Nothing falls back to another
 *   header, and nothing defaults to a trusting value.
 */

type Header = { key: string; value: string };

/** The authserv-id Cloudflare Email Routing writes in Authentication-Results. */
export const CLOUDFLARE_AUTHSERV_ID = "mx.cloudflare.net";

export function headerValues(headers: Header[], name: string) {
  const lower = name.toLowerCase();
  return headers
    .filter((header) => header.key.toLowerCase() === lower)
    .map((header) => header.value);
}

/**
 * Splits a structured header on top-level ';'.
 *
 * Comments (nested, with quoted-pairs) become a space; quoted strings are
 * kept whole, so a ';' or '(' inside either never splits. Returns null on
 * anything unbalanced: a header we cannot read the same way its writer did is
 * not read at all.
 */
function splitTopLevel(raw: string): string[] | null {
  const segments: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (character === "\\" && (quoted || depth > 0)) {
      if (index + 1 >= raw.length) return null;
      if (quoted) current += character + raw[index + 1];
      index += 1;
      continue;
    }
    if (quoted) {
      current += character;
      if (character === '"') quoted = false;
      continue;
    }
    if (character === "(") {
      if (depth === 0) current += " ";
      depth += 1;
      continue;
    }
    if (depth > 0) {
      if (character === ")") depth -= 1;
      continue;
    }
    if (character === ")") return null;
    if (character === '"') quoted = true;
    if (character === ";") {
      segments.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (quoted || depth > 0) return null;
  segments.push(current.trim());
  return segments;
}

/** RFC 8601 result values. */
const RESULTS = new Set([
  "none",
  "pass",
  "fail",
  "softfail",
  "neutral",
  "policy",
  "temperror",
  "permerror",
]);
/** "method[/version]=result", then properties, at the start of a segment. */
const RESINFO = /^([a-z][a-z0-9_-]*)(?:\/\d+)?\s*=\s*([a-z]+)(?=\s|$)/i;
/** pvalue: a run of quoted strings and non-space characters. */
const PVALUE = String.raw`(?:"(?:[^"\\]|\\.)*"|[^\s"])+`;
/** "ptype.property=pvalue" or "reason=value". */
const PROPERTY = new RegExp(
  String.raw`^\s*((?:smtp|header|body|policy)\.[a-z0-9_-]+(?:\.[a-z0-9_-]+)*|reason)\s*=\s*(${PVALUE})`,
  "i",
);

type AuthResult = { method: string; verdict: string; props: Record<string, string> };

/**
 * Parses one Authentication-Results value, or returns null when it is not
 * Cloudflare's or is not strictly well formed. An empty array means
 * Cloudflare checked and recorded "none".
 */
export function parseCloudflareResults(value: string): AuthResult[] | null {
  // Unfold: a fold is CRLF followed by whitespace, which stays.
  const segments = splitTopLevel(value.replace(/\r?\n/g, ""));
  if (!segments) return null;

  // authserv-id, optionally followed by a version number.
  const [id = "", ...rest] = segments;
  const idTokens = id.split(/\s+/).filter(Boolean);
  if (idTokens.length < 1 || idTokens.length > 2) return null;
  if (idTokens[0]!.toLowerCase() !== CLOUDFLARE_AUTHSERV_ID) return null;
  if (idTokens[1] !== undefined && !/^\d+$/.test(idTokens[1])) return null;

  // A trailing ';' leaves one empty segment; any other empty one is malformed.
  const entries = rest.at(-1) === "" ? rest.slice(0, -1) : rest;
  if (entries.length === 1 && entries[0]!.toLowerCase() === "none") return [];

  const results: AuthResult[] = [];
  for (const entry of entries) {
    const match = entry.match(RESINFO);
    if (!match) return null;
    const verdict = match[2]!.toLowerCase();
    if (!RESULTS.has(verdict)) return null;

    const props: Record<string, string> = {};
    let tail = entry.slice(match[0].length);
    while (tail.trim()) {
      const property = tail.match(PROPERTY);
      if (!property) return null;
      props[property[1]!.toLowerCase()] = property[2]!.replace(/^"|"$/g, "");
      tail = tail.slice(property[0].length);
    }
    results.push({ method: match[1]!.toLowerCase(), verdict, props });
  }
  return results;
}

/** The single verdict a list of entries agrees on, or null when they differ. */
function agreed(entries: AuthResult[]) {
  const verdicts = new Set(entries.map((entry) => entry.verdict));
  return verdicts.size === 1 ? [...verdicts][0]! : null;
}

function domainOf(address: string | undefined) {
  const clean = (address ?? "").trim().replace(/^<|>$/g, "");
  const at = clean.lastIndexOf("@");
  const domain = (at < 0 ? clean : clean.slice(at + 1)).toLowerCase().replace(/\.$/, "");
  return domain || null;
}

export interface AuthInput {
  /** TRUST_AUTH_RESULTS: the deployment confirmed Cloudflare stamps every message. */
  trusted: boolean;
  /** The runtime's SMTP envelope sender, `message.from`. */
  envelopeFrom: string;
  /** The From header address, used only to prefer an aligned signature. */
  fromAddress: string;
}

export interface AuthOutput {
  auth: { spf: string | null; dkim: string | null; dmarc: string | null };
  mailedBy: string | null;
  signedBy: string | null;
  tls: string | null;
}

const NOTHING: AuthOutput = {
  auth: { spf: null, dkim: null, dmarc: null },
  mailedBy: null,
  signedBy: null,
  tls: null,
};

/**
 * Everything the worker reports about who sent a message and how.
 *
 * - spf: the smtp.mailfrom check; several that disagree mean null.
 * - dkim: "pass" if any signature passed, else the agreed verdict.
 * - dmarc: the agreed verdict; duplicates that disagree mean null.
 * - mailedBy: the envelope sender's domain, only when Cloudflare's SPF check
 *   of that same domain passed. The sender picks MAIL FROM freely.
 * - signedBy: header.d (or header.i's domain) of a dkim=pass result,
 *   preferring the one aligned with From. A DKIM-Signature header alone
 *   proves nothing.
 * - tls: from the topmost Received, only when it was written by Cloudflare.
 */
export function readAuth(headers: Header[], input: AuthInput): AuthOutput {
  if (!input.trusted) return NOTHING;
  const top = headerValues(headers, "authentication-results")[0];
  const results = top === undefined ? null : parseCloudflareResults(top);
  if (!results) return NOTHING;

  const of = (method: string) => results.filter((result) => result.method === method);

  const spfAll = of("spf");
  const spfMailfrom = spfAll.filter((result) => "smtp.mailfrom" in result.props);
  const spf = spfMailfrom.length > 0 ? agreed(spfMailfrom) : spfAll.length === 1 ? spfAll[0]!.verdict : null;

  const dkimAll = of("dkim");
  const dkimPassed = dkimAll.filter((result) => result.verdict === "pass");
  const dkim = dkimPassed.length > 0 ? "pass" : dkimAll.length > 0 ? agreed(dkimAll) : null;

  const dmarcAll = of("dmarc");
  const dmarc = dmarcAll.length > 0 ? agreed(dmarcAll) : null;

  const envelopeDomain = domainOf(input.envelopeFrom);
  const mailfromDomains = new Set(spfMailfrom.map((result) => domainOf(result.props["smtp.mailfrom"])));
  const mailedBy =
    spf === "pass" && envelopeDomain && mailfromDomains.size === 1 && mailfromDomains.has(envelopeDomain)
      ? envelopeDomain
      : null;

  const signers = dkimPassed
    .map((result) => domainOf(result.props["header.d"] ?? result.props["header.i"]))
    .filter((domain): domain is string => Boolean(domain));
  const fromDomain = domainOf(input.fromAddress) ?? "";
  const signedBy =
    signers.find((domain) => fromDomain === domain || fromDomain.endsWith(`.${domain}`)) ??
    signers[0] ??
    null;

  return { auth: { spf, dkim, dmarc }, mailedBy, signedBy, tls: parseTls(headers) };
}

/**
 * How the last hop reached Cloudflare, from the topmost Received header,
 * read only from what follows "by mx.cloudflare.net": the "from" part before
 * it carries the sender's HELO name. Only called once trust is established.
 */
function parseTls(headers: Header[]) {
  const received = headerValues(headers, "received")[0]?.replace(/\r?\n/g, "");
  if (!received) return null;
  const at = received.search(/\bby\s+mx\.cloudflare\.net\b/i);
  if (at < 0) return null;
  const tail = received.slice(at);

  const version = tail.match(/\bversion=(TLS[\w.]+)/i)?.[1];
  if (version) return version.replace(/_/g, ".").toUpperCase();
  if (/\bwith\s+E?SMTPS\b/i.test(tail)) return "TLS";
  if (/\bwith\s+E?SMTPA?\b/i.test(tail)) return "none";
  return null;
}
