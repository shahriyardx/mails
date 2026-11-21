/**
 * Search box filters, for showing them as chips. The server's parser
 * (internal/mail/search.go) is the one that counts; this copy follows it,
 * and both are tested against internal/mail/testdata/search.json.
 */

export interface SearchTerm {
  op: string;
  value: string;
  /** As typed, so removing a chip removes exactly this. */
  raw: string;
}

export interface ParsedSearch {
  terms: SearchTerm[];
  text: string;
}

const VIEWS = new Set([
  "inbox",
  "sent",
  "drafts",
  "archive",
  "spam",
  "trash",
  "starred",
  "snoozed",
  "all",
]);

/** Every filter, for the "Filters" hint. */
export const SEARCH_FILTERS: { example: string; meaning: string }[] = [
  { example: "from:ada", meaning: "Sender name or address" },
  { example: "to:bob", meaning: "Recipient, cc or bcc" },
  { example: 'subject:"q3 plan"', meaning: "Words in the subject" },
  { example: "has:attachment", meaning: "With files" },
  { example: "is:unread", meaning: "Unread (or is:read)" },
  { example: "is:starred", meaning: "Starred" },
  { example: "label:work", meaning: "With a label" },
  { example: "in:archive", meaning: "In a folder, or in:all" },
  { example: "after:2026-01-31", meaning: "On or after a day" },
  { example: "before:2026-02-01", meaning: "Before a day" },
];

function term(op: string, raw: string): { op: string; value: string } | null {
  const value = raw.replace(/^"+|"+$/g, "").trim();
  const lower = value.toLowerCase();
  switch (op) {
    case "from":
    case "to":
    case "subject":
    case "label":
      return value ? { op, value } : null;
    case "has":
      return lower === "attachment" || lower === "attachments" ? { op, value: "attachment" } : null;
    case "is":
      return ["unread", "read", "starred"].includes(lower) ? { op, value: lower } : null;
    case "in":
      return VIEWS.has(lower) ? { op, value: lower } : null;
    case "before":
    case "after": {
      const day = value.replaceAll("/", "-");
      const ok = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00Z`));
      return ok && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day)
        ? { op, value: day }
        : null;
    }
    default:
      return null;
  }
}

/** Splits on spaces, keeping "quoted text" in one piece (an unclosed quote runs to the end). */
function tokens(q: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of q) {
    if (ch === '"') {
      quoted = !quoted;
      current += ch;
    } else if (!quoted && (ch === " " || ch === "\t" || ch === "\n")) {
      if (current) out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) out.push(current);
  return out;
}

export function parseSearch(q: string): ParsedSearch {
  const terms: SearchTerm[] = [];
  const text: string[] = [];
  for (const raw of tokens(q)) {
    const colon = raw.indexOf(":");
    const found = colon > 0 ? term(raw.slice(0, colon).toLowerCase(), raw.slice(colon + 1)) : null;
    if (found) terms.push({ ...found, raw });
    else text.push(raw);
  }
  return { terms, text: text.join(" ") };
}

/** The query without one of its filters. */
export function withoutTerm(q: string, index: number): string {
  const { terms, text } = parseSearch(q);
  return [...terms.filter((_, i) => i !== index).map((t) => t.raw), text].filter(Boolean).join(" ");
}

/** A chip's words: "from: Ada L", "has attachment", "is unread". */
export function termLabel(t: SearchTerm): string {
  return t.op === "has" || t.op === "is" ? `${t.op} ${t.value}` : `${t.op}: ${t.value}`;
}
