// Pure helpers behind the settings pages: DNS names, domain status, filter
// forms, Cloudflare receiving results. No React, so they are unit tested.
import type { Domain, Filter, FilterFolder, FilterInput, Label, Receiving } from "./types";

// ---- Domains --------------------------------------------------------------

/**
 * A record's name as DNS hosts want it typed: relative to the zone, "@" for
 * the zone itself. Names outside the zone stay whole.
 */
export function relativeName(name: string, zone: string) {
  const n = name.toLowerCase().replace(/\.$/, "");
  const z = zone.toLowerCase().replace(/\.$/, "");
  if (n === z) return "@";
  return n.endsWith(`.${z}`) ? n.slice(0, -(z.length + 1)) : n;
}

/**
 * Subdomains that send on a parent's verification, listed under it. One
 * whose parent is not here stays at the top level.
 */
export function nestDomains(domains: Domain[]) {
  const names = new Set(domains.map((d) => d.name));
  const byName = (a: Domain, b: Domain) => a.name.localeCompare(b.name);
  return domains
    .filter((d) => !d.inherited_from || !names.has(d.inherited_from))
    .sort(byName)
    .map((domain) => ({
      domain,
      children: domains.filter((c) => c.inherited_from === domain.name).sort(byName),
    }));
}

export interface DomainCheck {
  key: "dkim" | "mail-from" | "spf" | "dmarc";
  label: string;
  ok: boolean;
  required: boolean;
}

/** What SES and DNS must agree on. An inherited subdomain has nothing. */
export function domainChecks(d: Domain): DomainCheck[] {
  if (d.inherited_from) return [];
  return [
    { key: "dkim", label: "DKIM", ok: d.dkim_status === "verified", required: true },
    ...(d.mail_from_domain
      ? [
          {
            key: "mail-from" as const,
            label: "Return path",
            ok: d.mail_from_status === "verified",
            required: true,
          },
        ]
      : []),
    { key: "spf", label: "SPF", ok: d.spf_verified, required: false },
    { key: "dmarc", label: "DMARC", ok: d.dmarc_verified, required: false },
  ];
}

const STATUS_TEXT: Record<Domain["status"], string> = {
  pending: "Pending",
  verified: "Verified",
  failed: "Failed",
  temporary_failure: "Temporary failure",
  not_started: "Not started",
};

/** One line for a domain's badge: ready, or what is still missing. */
export function domainSummary(d: Domain): { ready: boolean; danger: boolean; text: string } {
  if (d.inherited_from) return { ready: true, danger: false, text: "No setup needed" };
  const verified = d.status === "verified" && d.sending_enabled;
  const blocking = domainChecks(d).filter((c) => c.required && !c.ok);
  if (verified && blocking.length === 0) return { ready: true, danger: false, text: "Ready" };
  if (!verified && d.status === "verified") {
    return { ready: false, danger: true, text: "Sending paused in SES" };
  }
  const parts = verified ? [] : [STATUS_TEXT[d.status] ?? d.status];
  if (blocking.length) parts.push(`${blocking.map((c) => c.label).join(" and ")} pending`);
  return { ready: false, danger: d.status === "failed", text: parts.join(" · ") };
}

/**
 * What "our own DKIM key" can do for a domain:
 * - "swap": SES's three DKIM CNAMEs become one TXT record with our key.
 * - "replace": the key was set up elsewhere and we never saw it, so a lost
 *   or deleted record can only be fixed with a new key.
 * Subdomains that sign with their parent's key get neither.
 */
export function ownDkimAction(d: Domain): "swap" | "replace" | null {
  if (d.inherited_from) return null;
  const dkim = d.records.filter((r) => r.purpose.startsWith("DKIM"));
  if (d.dkim_origin === "EXTERNAL") return dkim.some((r) => r.informational) ? "replace" : null;
  return dkim.filter((r) => r.kind === "CNAME").length > 1 ? "swap" : null;
}

// ---- Mailboxes ------------------------------------------------------------

/** What creating a subdomain mailbox did about receiving, in one sentence. */
export function receivingNote(r: Receiving | undefined): { ok: boolean; text: string } | null {
  if (!r) return null;
  switch (r.state) {
    case "published":
      return {
        ok: true,
        text: `Published Cloudflare's MX records for ${r.domain} in ${r.zone}, so it receives mail now.`,
      };
    case "already":
      return { ok: true, text: "This subdomain already has MX records, so nothing was changed." };
    default:
      return {
        ok: false,
        text: `Receiving was not set up: ${r.reason ?? "unknown reason"}. Add the MX records by hand, or fix this and create the mailbox again.`,
      };
  }
}

// ---- Filters --------------------------------------------------------------

/** A filter as the form edits it: every text field a string. */
export interface FilterForm {
  name: string;
  enabled: boolean;
  priority: string;
  match_from: string;
  match_to: string;
  match_subject: string;
  match_body: string;
  action_folder: FilterFolder | "";
  action_label_id: string;
  action_mark_read: boolean;
  action_star: boolean;
}

export type FilterErrors = Partial<Record<"name" | "priority" | "match" | "action", string>>;

export const MATCH_FIELDS = ["match_from", "match_to", "match_subject", "match_body"] as const;

export const emptyFilterForm: FilterForm = {
  name: "",
  enabled: true,
  priority: "0",
  match_from: "",
  match_to: "",
  match_subject: "",
  match_body: "",
  action_folder: "",
  action_label_id: "",
  action_mark_read: false,
  action_star: false,
};

export function formFromFilter(f: Filter): FilterForm {
  return {
    name: f.name,
    enabled: f.enabled,
    priority: String(f.priority),
    match_from: f.match_from ?? "",
    match_to: f.match_to ?? "",
    match_subject: f.match_subject ?? "",
    match_body: f.match_body ?? "",
    action_folder: f.action_folder ?? "",
    action_label_id: f.action_label_id ?? "",
    action_mark_read: f.action_mark_read,
    action_star: f.action_star,
  };
}

/**
 * Checks a filter form the way the server does (name, at least one
 * condition, lengths) and adds one rule of its own: a filter must do
 * something. Returns the request body when the form is valid.
 */
export function validateFilter(form: FilterForm): { input?: FilterInput; errors: FilterErrors } {
  const errors: FilterErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = "Give the filter a name";
  else if (name.length > 100) errors.name = "At most 100 characters";

  const priority = Number(form.priority.trim() || "0");
  if (!Number.isInteger(priority) || Math.abs(priority) > 1_000_000) {
    errors.priority = "A whole number";
  }

  const match = Object.fromEntries(
    MATCH_FIELDS.map((key) => [key, form[key].trim() || null]),
  ) as Record<(typeof MATCH_FIELDS)[number], string | null>;
  if (MATCH_FIELDS.every((key) => !match[key])) errors.match = "Add at least one condition";
  else if (MATCH_FIELDS.some((key) => (match[key]?.length ?? 0) > 500)) {
    errors.match = "Each condition is at most 500 characters";
  }

  if (!form.action_folder && !form.action_label_id && !form.action_mark_read && !form.action_star) {
    errors.action = "Choose at least one thing to do";
  }

  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    input: {
      name,
      enabled: form.enabled,
      priority,
      ...match,
      action_folder: form.action_folder || null,
      action_label_id: form.action_label_id || null,
      action_mark_read: form.action_mark_read,
      action_star: form.action_star,
    },
  };
}

const MATCH_TEXT = {
  match_from: "From",
  match_to: "To",
  match_subject: "Subject",
  match_body: "Body",
} as const;

const FOLDER_TEXT: Record<FilterFolder, string> = {
  inbox: "Keep in inbox",
  archive: "Archive",
  spam: "Mark as spam",
  trash: "Move to trash",
};

/** "From has x, Subject has y → Archive, label News, mark read". */
export function describeFilter(f: Filter | FilterInput, labels: Label[] = []) {
  const when = MATCH_FIELDS.filter((key) => f[key])
    .map((key) => `${MATCH_TEXT[key]} has "${f[key]}"`)
    .join(", ");
  const label = f.action_label_id && labels.find((l) => l.id === f.action_label_id);
  const then = [
    f.action_folder && FOLDER_TEXT[f.action_folder],
    f.action_label_id && `label ${label ? label.name : "(deleted)"}`,
    f.action_mark_read && "mark read",
    f.action_star && "star",
  ].filter(Boolean);
  return then.length ? `${when} → ${then.join(", ")}` : when;
}
