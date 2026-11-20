-- Indexes in the order the lists page through (cursor = sort key + id):
-- every message newest first, sent mail newest first (/api/v1/emails),
-- the delivery log of sent mail, and contacts by recency or count.

-- +goose Up
CREATE INDEX message_received_idx ON message (received_at DESC, id DESC);
CREATE INDEX message_outbound_received_idx ON message (received_at DESC, id DESC) WHERE is_outbound AND NOT is_draft;
DROP INDEX message_sent_idx;
CREATE INDEX message_sent_idx ON message (coalesce(sent_at, created_at) DESC, id DESC) WHERE is_outbound AND NOT is_draft;
CREATE INDEX contact_recent_idx ON contact (last_seen_at DESC, id DESC);
CREATE INDEX contact_frequent_idx ON contact (message_count DESC, id DESC);

-- +goose Down
DROP INDEX contact_frequent_idx;
DROP INDEX contact_recent_idx;
DROP INDEX message_sent_idx;
CREATE INDEX message_sent_idx ON message (coalesce(sent_at, created_at) DESC) WHERE is_outbound AND NOT is_draft;
DROP INDEX message_outbound_received_idx;
DROP INDEX message_received_idx;
