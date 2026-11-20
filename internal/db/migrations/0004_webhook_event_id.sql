-- A webhook event keeps one id across its retries and replays, so a
-- receiver can drop duplicates. Each attempt is still its own row.

-- +goose Up
ALTER TABLE webhook_delivery ADD COLUMN event_id text;
UPDATE webhook_delivery SET event_id = id WHERE event_id IS NULL;
ALTER TABLE webhook_delivery ALTER COLUMN event_id SET NOT NULL;
CREATE INDEX webhook_delivery_created_idx ON webhook_delivery (created_at DESC, id DESC);

-- +goose Down
DROP INDEX webhook_delivery_created_idx;
ALTER TABLE webhook_delivery DROP COLUMN event_id;
