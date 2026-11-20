package mail

import (
	"context"
	"fmt"

	"github.com/shahriyardx/mails/internal/db"
)

// Recompute refreshes what a thread caches about its messages (subject,
// snippet, folders, participants, counts, flags), in one statement, and
// deletes the thread when no message is left. Call it after any write that
// touches a message.
func Recompute(ctx context.Context, q db.Querier, threadID string) error {
	if _, err := q.Exec(ctx, `DELETE FROM thread t WHERE t.id = $1
		AND NOT EXISTS (SELECT 1 FROM message WHERE thread_id = $1)`, threadID); err != nil {
		return fmt.Errorf("delete empty thread: %w", err)
	}
	_, err := q.Exec(ctx, `
WITH m AS (SELECT * FROM message WHERE thread_id = $1),
latest AS (SELECT subject, snippet, received_at FROM m ORDER BY received_at DESC, id DESC LIMIT 1),
people AS (
	SELECT DISTINCT ON (address) address, name, ord FROM (
		SELECT from_address AS address, from_name AS name, 0 AS pri, received_at AS ord FROM m
		UNION ALL
		SELECT e->>'address', e->>'name', 1, m.received_at
		FROM m, jsonb_array_elements(m.to_addrs || m.cc_addrs) e
	) x WHERE address IS NOT NULL ORDER BY address, pri, ord
)
UPDATE thread t SET
	subject = latest.subject,
	snippet = latest.snippet,
	last_message_at = latest.received_at,
	folders = (SELECT array_agg(DISTINCT folder) FROM m),
	message_count = (SELECT count(*) FROM m),
	unread_count = (SELECT count(*) FROM m WHERE NOT is_read AND NOT is_outbound),
	is_starred = (SELECT bool_or(is_starred) FROM m),
	has_attachments = EXISTS (SELECT 1 FROM attachment a JOIN m ON a.message_id = m.id WHERE NOT a.is_inline),
	participants = (SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'address', address) ORDER BY ord, address), '[]') FROM people)
FROM latest WHERE t.id = $1`, threadID)
	if err != nil {
		return fmt.Errorf("recompute thread %s: %w", threadID, err)
	}
	return nil
}
