-- Mails: the whole schema for a fresh instance. One owner, no organizations.

-- +goose Up

CREATE TYPE folder AS ENUM ('inbox', 'sent', 'drafts', 'archive', 'spam', 'trash');
CREATE TYPE domain_status AS ENUM ('pending', 'verified', 'failed', 'temporary_failure', 'not_started');
CREATE TYPE delivery_status AS ENUM ('queued', 'sent', 'delivered', 'bounced', 'complained', 'rejected', 'delayed', 'failed', 'canceled');
CREATE TYPE send_job_status AS ENUM ('pending', 'sending', 'sent', 'failed', 'canceled');
CREATE TYPE event_type AS ENUM ('send', 'delivery', 'bounce', 'complaint', 'reject', 'open', 'click', 'delivery_delay', 'rendering_failure');

-- The owner. The first GitHub sign-in creates the only row; the app refuses a second.
CREATE TABLE app_user (
  id          text PRIMARY KEY,
  github_id   bigint NOT NULL UNIQUE,
  login       text NOT NULL,
  name        text NOT NULL,
  email       text NOT NULL,
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Browser sessions, in the shape alexedwards/scs pgxstore expects.
CREATE TABLE sessions (
  token   text PRIMARY KEY,
  data    bytea NOT NULL,
  expiry  timestamptz NOT NULL
);
CREATE INDEX sessions_expiry_idx ON sessions (expiry);

-- Instance-wide settings. Always exactly one row, id = 1.
CREATE TABLE settings (
  id                  int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  brand_name          text,
  setup_completed_at  timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (id) VALUES (1);

-- Per-owner display choices.
CREATE TABLE preference (
  user_id         text PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  density         text NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable', 'compact')),
  reading_layout  text NOT NULL DEFAULT 'split' CHECK (reading_layout IN ('split', 'stacked')),
  nav_collapsed   boolean NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE domain (
  id                     text PRIMARY KEY,
  name                   text NOT NULL UNIQUE,
  region                 text NOT NULL,
  status                 domain_status NOT NULL DEFAULT 'pending',
  sending_enabled        boolean NOT NULL DEFAULT false,
  dkim_status            domain_status NOT NULL DEFAULT 'pending',
  dkim_origin            text,
  dkim_tokens            text[] NOT NULL DEFAULT '{}',
  dkim_public_key        text,
  mail_from_domain       text,
  mail_from_status       domain_status,
  spf_verified           boolean NOT NULL DEFAULT false,
  dmarc_verified         boolean NOT NULL DEFAULT false,
  inherited_from         text,
  auto_create_mailboxes  boolean NOT NULL DEFAULT false,
  forward_off            boolean NOT NULL DEFAULT false,
  imported_at            timestamptz,
  last_checked_at        timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mailbox (
  id            text PRIMARY KEY,
  address       text NOT NULL UNIQUE,
  domain        text NOT NULL,
  domain_id     text REFERENCES domain(id) ON DELETE SET NULL,
  display_name  text NOT NULL,
  signature     text,
  is_catch_all  boolean NOT NULL DEFAULT false,
  is_default    boolean NOT NULL DEFAULT false,
  color         text NOT NULL DEFAULT '#9a9a9a',
  forward_off   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mailbox_domain_idx ON mailbox (domain);

CREATE TABLE forward_address (
  id              text PRIMARY KEY,
  address         text NOT NULL UNIQUE,
  destination_id  text,
  verified_at     timestamptz,
  checked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- domain_id set: domain-wide. mailbox_id set: one mailbox. Neither: the whole instance.
CREATE TABLE forward_rule (
  id          text PRIMARY KEY,
  address_id  text NOT NULL REFERENCES forward_address(id) ON DELETE CASCADE,
  domain_id   text REFERENCES domain(id) ON DELETE CASCADE,
  mailbox_id  text REFERENCES mailbox(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forward_rule_domain_idx ON forward_rule (domain_id);
CREATE INDEX forward_rule_mailbox_idx ON forward_rule (mailbox_id);

CREATE TABLE thread (
  id               text PRIMARY KEY,
  mailbox_id       text NOT NULL REFERENCES mailbox(id) ON DELETE CASCADE,
  subject          text NOT NULL DEFAULT '',
  snippet          text NOT NULL DEFAULT '',
  folders          folder[] NOT NULL DEFAULT '{}',
  participants     jsonb NOT NULL DEFAULT '[]',
  message_count    int NOT NULL DEFAULT 0,
  unread_count     int NOT NULL DEFAULT 0,
  is_starred       boolean NOT NULL DEFAULT false,
  has_attachments  boolean NOT NULL DEFAULT false,
  last_message_at  timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX thread_mailbox_last_idx ON thread (mailbox_id, last_message_at DESC);
CREATE INDEX thread_last_idx ON thread (last_message_at DESC);
CREATE INDEX thread_folders_idx ON thread USING gin (folders);

CREATE TABLE api_key (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  prefix             text NOT NULL,
  hash               text NOT NULL UNIQUE,
  mailbox_id         text REFERENCES mailbox(id) ON DELETE CASCADE,
  scope_mailbox_ids  text[] NOT NULL DEFAULT '{}',
  scope_domain_ids   text[] NOT NULL DEFAULT '{}',
  scopes             text[] NOT NULL DEFAULT '{}',
  rate_limit         int,
  last_used_at       timestamptz,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE message (
  id                text PRIMARY KEY,
  thread_id         text NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  mailbox_id        text NOT NULL REFERENCES mailbox(id) ON DELETE CASCADE,
  rfc_message_id    text,
  in_reply_to       text,
  "references"      text[] NOT NULL DEFAULT '{}',
  from_name         text,
  from_address      text NOT NULL,
  to_addrs          jsonb NOT NULL DEFAULT '[]',
  cc_addrs          jsonb NOT NULL DEFAULT '[]',
  bcc_addrs         jsonb NOT NULL DEFAULT '[]',
  reply_to          text,
  subject           text NOT NULL DEFAULT '',
  snippet           text NOT NULL DEFAULT '',
  text_body         text,
  html_body         text,
  folder            folder NOT NULL DEFAULT 'inbox',
  previous_folder   folder,
  is_read           boolean NOT NULL DEFAULT false,
  is_starred        boolean NOT NULL DEFAULT false,
  is_draft          boolean NOT NULL DEFAULT false,
  is_outbound       boolean NOT NULL DEFAULT false,
  spf               text,
  dkim              text,
  dmarc             text,
  spam_score        int,
  mailed_by         text,
  signed_by         text,
  tls               text,
  ses_message_id    text,
  delivery_status   delivery_status,
  delivery_error    text,
  opened_at         timestamptz,
  open_count        int NOT NULL DEFAULT 0,
  api_key_id        text REFERENCES api_key(id) ON DELETE SET NULL,
  size_bytes        int NOT NULL DEFAULT 0,
  raw_key           text,
  sent_at           timestamptz,
  received_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  search_vector     tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(subject, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(from_address, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(text_body, '')), 'C')
  ) STORED
);
CREATE INDEX message_thread_idx ON message (thread_id, received_at);
CREATE INDEX message_mailbox_folder_idx ON message (mailbox_id, folder, received_at DESC);
CREATE UNIQUE INDEX message_rfc_id_idx ON message (mailbox_id, rfc_message_id);
CREATE INDEX message_search_idx ON message USING gin (search_vector);
CREATE INDEX message_ses_id_idx ON message (ses_message_id);

CREATE TABLE attachment (
  id            text PRIMARY KEY,
  message_id    text REFERENCES message(id) ON DELETE CASCADE,
  filename      text NOT NULL,
  content_type  text NOT NULL DEFAULT 'application/octet-stream',
  size_bytes    int NOT NULL DEFAULT 0,
  r2_key        text NOT NULL,
  content_id    text,
  is_inline     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachment_message_idx ON attachment (message_id);

CREATE TABLE label (
  id          text PRIMARY KEY,
  name        text NOT NULL UNIQUE,
  color       text NOT NULL DEFAULT '#8a8a8a',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE thread_label (
  thread_id  text NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  label_id   text NOT NULL REFERENCES label(id) ON DELETE CASCADE,
  PRIMARY KEY (thread_id, label_id)
);

CREATE TABLE contact (
  id             text PRIMARY KEY,
  address        text NOT NULL UNIQUE,
  name           text,
  message_count  int NOT NULL DEFAULT 0,
  last_seen_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE message_event (
  id              text PRIMARY KEY,
  message_id      text REFERENCES message(id) ON DELETE CASCADE,
  ses_message_id  text,
  type            event_type NOT NULL,
  recipient       text,
  detail          text,
  payload         jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_event_message_idx ON message_event (message_id);
CREATE INDEX message_event_ses_idx ON message_event (ses_message_id);
CREATE INDEX message_event_time_idx ON message_event (occurred_at DESC);

CREATE TABLE suppression (
  id          text PRIMARY KEY,
  address     text NOT NULL UNIQUE,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Third-party credentials entered in the app (Cloudflare token). Secret is encrypted.
CREATE TABLE integration (
  id           text PRIMARY KEY,
  provider     text NOT NULL UNIQUE,
  secret       text NOT NULL,
  hint         text NOT NULL,
  label        text,
  account_id   text,
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE image_trust (
  sender      text PRIMARY KEY,
  allowed     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE filter_rule (
  id                text PRIMARY KEY,
  name              text NOT NULL,
  enabled           boolean NOT NULL DEFAULT true,
  priority          int NOT NULL DEFAULT 0,
  match_from        text,
  match_to          text,
  match_subject     text,
  match_body        text,
  action_folder     folder,
  action_label_id   text REFERENCES label(id) ON DELETE SET NULL,
  action_mark_read  boolean NOT NULL DEFAULT false,
  action_star       boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook (
  id                    text PRIMARY KEY,
  url                   text NOT NULL,
  description           text,
  events                text[] NOT NULL DEFAULT '{}',
  secret                text NOT NULL,
  enabled               boolean NOT NULL DEFAULT true,
  mailbox_id            text REFERENCES mailbox(id) ON DELETE CASCADE,
  domain_id             text REFERENCES domain(id) ON DELETE CASCADE,
  last_status           int,
  last_delivered_at     timestamptz,
  last_error_at         timestamptz,
  last_error            text,
  consecutive_failures  int NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_delivery (
  id             text PRIMARY KEY,
  webhook_id     text NOT NULL REFERENCES webhook(id) ON DELETE CASCADE,
  event          text NOT NULL,
  payload        jsonb NOT NULL,
  attempt        int NOT NULL DEFAULT 1,
  status_code    int,
  response_body  text,
  error          text,
  duration_ms    int,
  succeeded      boolean NOT NULL DEFAULT false,
  next_retry_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_delivery_hook_idx ON webhook_delivery (webhook_id, created_at DESC);
CREATE INDEX webhook_delivery_retry_idx ON webhook_delivery (next_retry_at) WHERE next_retry_at IS NOT NULL;

CREATE TABLE idempotency_record (
  key           text PRIMARY KEY,
  request_hash  text NOT NULL,
  endpoint      text NOT NULL,
  status_code   int NOT NULL,
  response      jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idempotency_created_idx ON idempotency_record (created_at);

CREATE TABLE send_job (
  id               text PRIMARY KEY,
  message_id       text NOT NULL UNIQUE REFERENCES message(id) ON DELETE CASCADE,
  mailbox_id       text NOT NULL REFERENCES mailbox(id) ON DELETE CASCADE,
  from_address     text NOT NULL,
  recipients       text[] NOT NULL DEFAULT '{}',
  raw_mime         bytea NOT NULL,
  status           send_job_status NOT NULL DEFAULT 'pending',
  attempts         int NOT NULL DEFAULT 0,
  max_attempts     int NOT NULL DEFAULT 8,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_at        timestamptz,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX send_job_due_idx ON send_job (status, next_attempt_at);

CREATE TABLE push_subscription (
  id            text PRIMARY KEY,
  endpoint      text NOT NULL UNIQUE,
  p256dh        text NOT NULL,
  auth          text NOT NULL,
  label         text,
  failures      int NOT NULL DEFAULT 0,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
