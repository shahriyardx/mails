-- Permanent deletes check whether any other row still points at a stored
-- file (one inbound payload stored for several mailboxes shares them).

-- +goose Up
CREATE INDEX attachment_r2_key_idx ON attachment (r2_key);
CREATE INDEX message_raw_key_idx ON message (raw_key) WHERE raw_key IS NOT NULL;

-- +goose Down
DROP INDEX message_raw_key_idx;
DROP INDEX attachment_r2_key_idx;
