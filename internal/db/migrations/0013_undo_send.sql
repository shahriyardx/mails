-- Undo send: a dashboard send waits in the queue for the owner's undo
-- window before it goes to SES. The wait is next_attempt_at (already
-- indexed with status for the outbox claim); undo_until marks the job as
-- one that can still turn back into a draft. It is only read by
-- message_id, which is unique.

-- +goose Up
ALTER TABLE send_job ADD COLUMN undo_until timestamptz;
ALTER TABLE preference ADD COLUMN undo_send_seconds int NOT NULL DEFAULT 10
  CHECK (undo_send_seconds IN (0, 5, 10, 20, 30));

-- +goose Down
ALTER TABLE preference DROP COLUMN undo_send_seconds;
ALTER TABLE send_job DROP COLUMN undo_until;
