-- A delivery attempt claimed by a worker that then died must be tried
-- again; locked_at shows how long a claim has been held.

-- +goose Up
ALTER TABLE webhook_delivery ADD COLUMN locked_at timestamptz;
CREATE INDEX webhook_delivery_locked_idx ON webhook_delivery (locked_at) WHERE locked_at IS NOT NULL;

-- +goose Down
DROP INDEX webhook_delivery_locked_idx;
ALTER TABLE webhook_delivery DROP COLUMN locked_at;
