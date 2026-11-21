// JSON shapes of the Go API (/api/app/*). Field names match the Go structs'
// json tags: internal/mail/types.go, internal/send/send.go, internal/mailbox,
// internal/auth, internal/setup.

export interface Owner {
  id: string;
  login: string;
  name: string;
  email: string;
  avatar_url?: string;
}

export interface AuthStatus {
  owner: Owner | null;
  claimed: boolean;
}

export interface Page<T> {
  object: "list";
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface Address {
  name: string | null;
  address: string;
}

export interface Label {
  object: "label";
  id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface Attachment {
  object: "attachment";
  id: string;
  message_id: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
  content_id: string | null;
  is_inline: boolean;
  created_at: string;
}

export type Folder = "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash";
export type ViewFolder = Folder | "starred";

export interface Message {
  object: "message";
  id: string;
  thread_id: string;
  mailbox_id: string;
  mailbox: string;
  message_id: string | null;
  in_reply_to: string | null;
  references: string[] | null;
  from: Address;
  to: Address[] | null;
  cc: Address[] | null;
  bcc: Address[] | null;
  reply_to: string | null;
  subject: string;
  snippet: string;
  folder: Folder;
  direction: "inbound" | "outbound";
  is_read: boolean;
  is_starred: boolean;
  is_draft: boolean;
  has_attachments: boolean;
  size_bytes: number;
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  spam_score: number | null;
  mailed_by: string | null;
  signed_by: string | null;
  tls: string | null;
  ses_message_id: string | null;
  status: string | null;
  error: string | null;
  opened_at: string | null;
  open_count: number;
  sent_at: string | null;
  received_at: string;
  created_at: string;
  text?: string | null;
  html?: string | null;
  attachments?: Attachment[];
}

export interface Thread {
  object: "thread";
  id: string;
  mailbox_id: string;
  mailbox: string;
  mailbox_color: string;
  domain: string;
  subject: string;
  snippet: string;
  folders: Folder[];
  participants: Address[] | null;
  message_count: number;
  unread_count: number;
  is_starred: boolean;
  has_attachments: boolean;
  last_message_at: string;
  created_at: string;
  labels: Label[] | null;
  messages?: Message[];
}

export interface ThreadFilter {
  folder?: ViewFolder;
  mailbox?: string;
  domain?: string;
  label?: string;
  q?: string;
  unread?: boolean;
}

export interface ThreadChange {
  folder?: Folder;
  is_read?: boolean;
  is_starred?: boolean;
  add_labels?: string[];
  remove_labels?: string[];
}

export interface Counts {
  folders: Record<string, number>;
  mailboxes: Record<string, number>;
}

export interface Mailbox {
  object: "mailbox";
  id: string;
  address: string;
  domain: string;
  domain_id: string | null;
  display_name: string;
  signature: string | null;
  is_catch_all: boolean;
  is_default: boolean;
  color: string;
  forward_off: boolean;
  created_at: string;
  /** Only on create, for a mailbox on a subdomain (cloudflare.Receiving). */
  receiving?: Receiving;
}

export interface Contact {
  object: "contact";
  id: string;
  address: string;
  name: string | null;
  message_count: number;
  last_seen_at: string;
}

export type ThemeChoice = "dark" | "light" | "system";

export interface Preferences {
  density: "comfortable" | "compact";
  reading_layout: "split" | "stacked";
  nav_collapsed: boolean | null;
  /** Missing on servers that do not keep it yet; localStorage covers that. */
  theme?: ThemeChoice;
  /** Seconds a send can be called back (0 = off). */
  undo_send_seconds?: UndoSeconds;
}

export const UNDO_SECONDS = [0, 5, 10, 20, 30] as const;
export type UndoSeconds = (typeof UNDO_SECONDS)[number];

export interface SetupStep {
  key: string;
  title: string;
  detail: string;
  href?: string;
  done: boolean;
}

export interface Setup {
  completed: boolean;
  completed_at: string | null;
  brand_name: string | null;
  steps: SetupStep[];
  remaining: number;
}

// ---- Developers and insights (internal/apikey, internal/webhook, internal/delivery)

/** A domain as the pickers need it (internal/domain Domain, trimmed). */
export interface DomainRef {
  id: string;
  name: string;
}

/** What a key may touch. Both empty (or null) means everything. */
export interface Reach {
  domains: string[] | null;
  mailboxes: string[] | null;
}

export interface ApiKey {
  object: "api_key";
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  reach: Reach;
  rate_limit_per_minute: number;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface ScopePreset {
  id: string;
  label: string;
  hint: string;
  scopes: string[];
}

export interface ScopeLevel {
  label: string;
  scopes: string[];
}

export interface ScopeArea {
  id: string;
  label: string;
  hint: string;
  levels: ScopeLevel[];
}

/** GET /api/app/api-keys */
export interface ApiKeyList {
  data: ApiKey[];
  scopes: string[];
  presets: ScopePreset[];
  areas: ScopeArea[];
}

export interface ApiKeyInput {
  name: string;
  scopes: string[];
  reach: { domains: string[]; mailboxes: string[] };
  rate_limit_per_minute?: number;
}

export interface Webhook {
  object: "webhook";
  id: string;
  url: string;
  description: string | null;
  events: string[];
  enabled: boolean;
  mailbox_id: string | null;
  domain_id: string | null;
  last_status: number | null;
  last_delivered_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  created_at: string;
  /** Only on create and rotate. */
  secret?: string;
}

export interface WebhookInput {
  url: string;
  description: string | null;
  events: string[];
  mailbox_id: string | null;
  domain_id: string | null;
  enabled?: boolean;
}

export interface WebhookPatch {
  url?: string;
  description?: string | null;
  events?: string[];
  enabled?: boolean;
  rotate_secret?: boolean;
  mailbox_id?: string | null;
  domain_id?: string | null;
}

export interface WebhookDelivery {
  object: "webhook_delivery";
  id: string;
  event_id: string;
  webhook_id: string;
  event: string;
  payload: unknown;
  attempt: number;
  status_code: number | null;
  response_body: string | null;
  error: string | null;
  duration_ms: number | null;
  succeeded: boolean;
  next_retry_at: string | null;
  created_at: string;
}

/** Ping and replay reply (internal/webhook Result). */
export interface WebhookResult {
  object: "webhook_ping";
  webhook_id: string;
  delivery_id?: string;
  succeeded: boolean;
  status_code: number | null;
  duration_ms: number;
  response_body: string | null;
  error: string | null;
}

export interface DeliveryFilter {
  webhook_id?: string;
  event?: string;
  succeeded?: "true" | "false";
}

export type DeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "bounced"
  | "complained"
  | "rejected"
  | "delayed"
  | "failed"
  | "canceled";

/** One row of GET /api/app/logs (internal/delivery LogRow). */
export interface LogRow {
  id: string;
  thread_id: string;
  subject: string;
  from: string;
  to: Address[] | null;
  status: DeliveryStatus | null;
  error: string | null;
  open_count: number;
  api_key_id: string | null;
  ses_message_id: string | null;
  at: string;
  mailbox: string;
  mailbox_color: string;
}

export interface LogFilter {
  direction: "sending" | "receiving";
  q?: string;
  status?: string;
  days?: number;
  api_key_id?: string;
}

/** A delivery event on a message (internal/mail Event). */
export interface MessageEvent {
  object: "event";
  id: string;
  type: string;
  recipient: string | null;
  detail: string | null;
  occurred_at: string;
}

/** GET /api/app/messages/{id}: the message with its events. */
export interface MessageDetail extends Message {
  events?: MessageEvent[];
}

export interface MetricsDay {
  day: string;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  opened: number;
}

export interface MetricsKind {
  kind: string;
  count: number;
  rate: number;
}

/** GET /api/app/metrics. Rates are 0..1 fractions, null with nothing sent. */
export interface Metrics {
  range: number;
  domain_id?: string;
  days: MetricsDay[];
  totals: MetricsDay;
  deliverability: number | null;
  bounce_rate: number | null;
  complaint_rate: number | null;
  open_rate: number | null;
  bounces: MetricsKind[];
  complaints: MetricsKind[];
}

/** The SES account (internal/ses Account). */
export interface SesAccount {
  production_access: boolean;
  enforcement_status: string;
  max_24_hour: number;
  sent_last_24_hours: number;
  max_send_rate: number;
}

/** GET /api/app/overview */
export interface Overview {
  account: SesAccount | null;
  error?: string;
  sent_24h: number;
  queued: number;
  failed_7d: number;
  blocked: number;
}

// ---- Settings: internal/domain, mailbox, cloudflare, forwarding, mail
// filters, delivery suppressions, push ---------------------------------------

export type DomainStatus = "pending" | "verified" | "failed" | "temporary_failure" | "not_started";

/** domain.Record: one DNS record to publish. `name` is the full hostname. */
export interface DnsRecord {
  kind: "CNAME" | "TXT" | "MX";
  name: string;
  value: string;
  priority?: number;
  purpose: string;
  required: boolean;
  /** The value is a note, not something to paste (a key set up elsewhere). */
  informational?: boolean;
}

export interface Domain {
  object: "domain";
  id: string;
  name: string;
  region: string;
  status: DomainStatus;
  sending_enabled: boolean;
  dkim_status: DomainStatus;
  dkim_origin: string | null;
  mail_from_domain: string | null;
  mail_from_status: DomainStatus | null;
  spf_verified: boolean;
  dmarc_verified: boolean;
  /** Set for a subdomain that sends on its parent's verification. */
  inherited_from: string | null;
  auto_create_mailboxes: boolean;
  forward_off: boolean;
  imported: boolean;
  last_checked_at: string | null;
  created_at: string;
  records: DnsRecord[];
}

export interface DomainImport {
  imported: number;
  updated: number;
  total: number;
}

/** cloudflare.Receiving: what was done so a new subdomain mailbox receives. */
export interface Receiving {
  state: "published" | "already" | "skipped";
  domain?: string;
  zone?: string;
  reason?: string;
}

/** Body of POST /api/app/mailboxes (mailbox.Input). */
export interface MailboxInput {
  address: string;
  display_name?: string;
  signature?: string | null;
  is_catch_all?: boolean;
  is_default?: boolean;
  color?: string;
}

/** Body of PATCH /api/app/mailboxes/{id} (mailbox.Patch). */
export type MailboxPatch = Partial<
  Pick<Mailbox, "display_name" | "is_catch_all" | "is_default" | "color" | "forward_off">
> & { signature?: string | null };

export interface ZoneStatus {
  id: string;
  name: string;
  routing_enabled: boolean;
  catch_all_to_worker: boolean;
}

/** cloudflare.Status: GET /api/app/inbound. */
export interface InboundStatus {
  connected: boolean;
  hint?: string;
  label?: string;
  account_id?: string;
  script_name: string;
  script_bytes: number;
  deployed: boolean;
  modified_on?: string;
  zones: ZoneStatus[];
  error?: string;
}

export interface ForwardAddress {
  id: string;
  address: string;
  verified: boolean;
  in_cloudflare: boolean;
  uses: number;
  created_at: string;
}

export interface ForwardRule {
  id: string;
  address_id: string;
}

/** A domain or mailbox with its forwarding rules (forwarding.Scoped). */
export interface ForwardScope {
  id: string;
  name: string;
  forward_off: boolean;
  rules: ForwardRule[];
}

/** forwarding.View: GET /api/app/forwarding. */
export interface ForwardingView {
  connected: boolean;
  addresses: ForwardAddress[];
  instance: ForwardRule[];
  domains: ForwardScope[];
  mailboxes: ForwardScope[];
}

export type FilterFolder = "inbox" | "archive" | "spam" | "trash";

/** mail.Filter. POST /api/app/filters creates, PUT /filters/{id} replaces. */
export interface Filter {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  match_from: string | null;
  match_to: string | null;
  match_subject: string | null;
  match_body: string | null;
  action_folder: FilterFolder | null;
  action_label_id: string | null;
  action_mark_read: boolean;
  action_star: boolean;
  created_at: string;
}

export type FilterInput = Omit<Filter, "id" | "created_at">;

/** delivery.Suppression: a blocked address. */
export interface Suppression {
  object: "suppression";
  id: string;
  address: string;
  reason: string;
  created_at: string;
}

/** push.Browser */
export interface PushBrowser {
  id: string;
  label: string | null;
  endpoint: string;
  created_at: string;
  last_seen_at: string;
}

/** GET /api/app/push. enabled is false when the VAPID keys are not set. */
export interface PushState {
  enabled: boolean;
  public_key: string;
  browsers: PushBrowser[];
}

/** Body of POST /api/app/send and /api/app/drafts. */
export interface OutgoingMail {
  from: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
  subject?: string;
  html?: string;
  text?: string;
  attachment_ids?: string[];
  thread_id?: string;
  in_reply_to?: string;
  references?: string[];
  draft_id?: string;
}

export interface SendResult {
  id: string;
  thread_id: string;
  status: string;
  error?: string;
  /** Held for the undo window until then (dashboard sends only). */
  undo_until?: string;
}

/** One event from /api/events. */
export interface LiveEvent {
  type: "mail.received" | "thread.updated" | "message.updated" | string;
  data?: { thread_id?: string; thread_ids?: string[]; message_id?: string };
}

/** GET /api/app/reporting (internal/reporting Status). */
export interface ReportingStatus {
  name: string;
  endpoint: string;
  configuration_set: boolean;
  destination: boolean;
  types: string[];
  topic_arn: string;
  subscription: "confirmed" | "pending" | "missing";
  active: boolean;
  required: string[];
  optional: string[];
  env_managed: boolean;
  error?: string;
}
