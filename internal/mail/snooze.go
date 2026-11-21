package mail

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/shahriyardx/mails/internal/db"
)

// wakeBatch caps one wake-up run; the rest wait for the next tick.
const wakeBatch = 500

// WakeSnoozed brings back every thread whose snooze has ended: archived
// received mail returns to the Inbox and the newest received message is
// marked unread. A thread in Trash or Spam only loses its snooze. Claimed
// with FOR UPDATE SKIP LOCKED, so two processes never wake one twice.
func (s *Service) WakeSnoozed(ctx context.Context) error {
	type woken struct{ ID, Subject string }
	var list []woken
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		rows, _ := tx.Query(ctx, `UPDATE thread SET snoozed_until = NULL WHERE id IN (
				SELECT id FROM thread WHERE snoozed_until <= now() ORDER BY snoozed_until LIMIT $1 FOR UPDATE SKIP LOCKED)
			RETURNING id, subject`, wakeBatch)
		var err error
		if list, err = pgx.CollectRows(rows, pgx.RowToStructByPos[woken]); err != nil {
			return fmt.Errorf("claim snoozed threads: %w", err)
		}
		if len(list) == 0 {
			return nil
		}
		ids := make([]string, len(list))
		for i, w := range list {
			ids[i] = w.ID
		}
		if _, err := tx.Exec(ctx, `UPDATE message SET folder = 'inbox', previous_folder = NULL
			WHERE thread_id = ANY($1) AND NOT is_outbound AND folder = 'archive'`, ids); err != nil {
			return fmt.Errorf("unsnooze to inbox: %w", err)
		}
		if _, err := tx.Exec(ctx, `UPDATE message SET is_read = false WHERE id IN (
				SELECT DISTINCT ON (thread_id) id FROM message WHERE thread_id = ANY($1) AND NOT is_outbound AND folder = 'inbox'
				ORDER BY thread_id, received_at DESC, id DESC)`, ids); err != nil {
			return fmt.Errorf("unsnooze unread: %w", err)
		}
		return recomputeAll(ctx, tx, ids)
	})
	if err != nil {
		return err
	}
	ids := make([]string, len(list))
	for i, w := range list {
		ids[i] = w.ID
		if s.OnWake != nil {
			s.OnWake(ctx, w.ID, w.Subject)
		}
	}
	s.threadsChanged(ids)
	return nil
}

// Unsnooze ends a thread's snooze, as new mail arriving in it does.
func Unsnooze(ctx context.Context, q db.Querier, threadID string) error {
	if _, err := q.Exec(ctx, `UPDATE thread SET snoozed_until = NULL WHERE id = $1 AND snoozed_until IS NOT NULL`, threadID); err != nil {
		return fmt.Errorf("unsnooze %s: %w", threadID, err)
	}
	return nil
}
