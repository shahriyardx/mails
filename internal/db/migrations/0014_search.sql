-- Search filters: from:, to: and subject: match any part of a name,
-- address or subject, and free text also looks at the sender and subject.
-- Trigram indexes serve those ILIKE '%...%' matches (pg_trgm is a trusted
-- extension: the database owner can create it). The expressions must stay
-- the same as fromExpr / toExpr in internal/mail/search.go. is:unread,
-- is:starred and has:attachment walk small partial indexes in list order.

-- +goose Up
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX message_from_trgm_idx ON message USING gin ((coalesce(from_name, '') || ' ' || from_address) gin_trgm_ops);
CREATE INDEX message_to_trgm_idx ON message USING gin ((jsonb_path_query_array(to_addrs || cc_addrs || bcc_addrs, '$[*].*')::text) gin_trgm_ops);
CREATE INDEX message_subject_trgm_idx ON message USING gin (subject gin_trgm_ops);
CREATE INDEX thread_unread_idx ON thread (last_message_at DESC, id DESC) WHERE unread_count > 0;
CREATE INDEX thread_starred_idx ON thread (last_message_at DESC, id DESC) WHERE is_starred;
CREATE INDEX thread_attachments_idx ON thread (last_message_at DESC, id DESC) WHERE has_attachments;

-- +goose Down
DROP INDEX thread_attachments_idx;
DROP INDEX thread_starred_idx;
DROP INDEX thread_unread_idx;
DROP INDEX message_subject_trgm_idx;
DROP INDEX message_to_trgm_idx;
DROP INDEX message_from_trgm_idx;
