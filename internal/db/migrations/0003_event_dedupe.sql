-- SNS delivers at least once. Its MessageId lets a repeat be ignored, so an
-- open is not counted twice and a webhook does not fire twice.

-- +goose Up
ALTER TABLE message_event ADD COLUMN sns_message_id text;
CREATE UNIQUE INDEX message_event_sns_idx ON message_event (sns_message_id) WHERE sns_message_id IS NOT NULL;
CREATE INDEX message_sent_idx ON message (coalesce(sent_at, created_at) DESC) WHERE is_outbound AND NOT is_draft;

-- +goose Down
DROP INDEX message_sent_idx;
DROP INDEX message_event_sns_idx;
ALTER TABLE message_event DROP COLUMN sns_message_id;
