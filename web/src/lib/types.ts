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
}

export interface Contact {
  object: "contact";
  id: string;
  address: string;
  name: string | null;
  message_count: number;
  last_seen_at: string;
}

export interface Preferences {
  density: "comfortable" | "compact";
  reading_layout: "split" | "stacked";
  nav_collapsed: boolean | null;
}

export interface SetupStep {
  key: string;
  title: string;
  detail: string;
  href?: string;
  done: boolean;
}

export interface Setup {
  completed: boolean;
  steps: SetupStep[];
  remaining: number;
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
}

/** One event from /api/events. */
export interface LiveEvent {
  type: "mail.received" | "thread.updated" | "message.updated" | string;
  data?: { thread_id?: string; thread_ids?: string[]; message_id?: string };
}
