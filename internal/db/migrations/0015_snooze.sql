-- Snooze: a thread leaves the Inbox until snoozed_until, then comes back
-- unread. The partial index serves the Snoozed list and the wake-up job.

-- +goose Up
ALTER TABLE thread ADD COLUMN snoozed_until timestamptz;
CREATE INDEX thread_snoozed_idx ON thread (snoozed_until) WHERE snoozed_until IS NOT NULL;

-- +goose Down
DROP INDEX thread_snoozed_idx;
ALTER TABLE thread DROP COLUMN snoozed_until;
