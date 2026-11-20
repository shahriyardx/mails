-- A Message-ID is unique per mailbox and direction. Sent mail stores the
-- Message-ID SES actually sent, so mail to yourself arrives with the same
-- id as its sent copy; it must still land in the inbox.

-- +goose Up
DROP INDEX message_rfc_id_idx;
CREATE UNIQUE INDEX message_rfc_id_idx ON message (mailbox_id, rfc_message_id, is_outbound);

-- +goose Down
DROP INDEX message_rfc_id_idx;
CREATE UNIQUE INDEX message_rfc_id_idx ON message (mailbox_id, rfc_message_id);
