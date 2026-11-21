package mail

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shahriyardx/mails/internal/db"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/realtime"
)

// ThreadChange is a set of changes applied together. Nil fields stay.
// Labels are given by id or name.
type ThreadChange struct {
	Folder       *string  `json:"folder"`
	IsRead       *bool    `json:"is_read"`
	IsStarred    *bool    `json:"is_starred"`
	AddLabels    []string `json:"add_labels"`
	RemoveLabels []string `json:"remove_labels"`
	// SnoozedUntil hides a thread from the Inbox until then (a future
	// time); null wakes it now, without marking it unread.
	SnoozedUntil httpx.Opt[time.Time] `json:"snoozed_until,omitzero"`
}

// ownedThreads returns which of ids exist within allowed.
func ownedThreads(ctx context.Context, q db.Querier, allowed, ids []string) ([]string, error) {
	var w where
	w.add("id = ANY(?)", ids)
	w.scope("mailbox_id", allowed, "", "")
	rows, _ := q.Query(ctx, `SELECT id FROM thread `+w.sql()+` FOR UPDATE`, w.args...)
	out, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("load threads: %w", err)
	}
	return out, nil
}

// ChangeThreads applies c to every thread in ids that allowed reaches, in
// one transaction. Labels are resolved first: an unknown one is a 422 and
// nothing is written. Returns the ids changed; a single unknown id is a 404.
func (s *Service) ChangeThreads(ctx context.Context, allowed, ids []string, c ThreadChange) ([]string, error) {
	if c.Folder != nil && !movable[*c.Folder] {
		return nil, httpx.Invalid("folder", "folder: One of inbox, archive, spam, trash")
	}
	if c.SnoozedUntil.Set && !c.SnoozedUntil.Null && !c.SnoozedUntil.Value.After(time.Now()) {
		return nil, httpx.Invalid("snoozed_until", "snoozed_until: A time in the future, or null")
	}
	var changed []string
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		add, err := resolveLabels(ctx, tx, c.AddLabels, "add_labels")
		if err != nil {
			return err
		}
		remove, err := resolveLabels(ctx, tx, c.RemoveLabels, "remove_labels")
		if err != nil {
			return err
		}
		if changed, err = ownedThreads(ctx, tx, allowed, ids); err != nil {
			return err
		}
		if len(changed) == 0 {
			return httpx.NotFound("No such thread")
		}
		if c.Folder != nil {
			if err := move(ctx, tx, changed, *c.Folder); err != nil {
				return err
			}
		}
		if c.IsRead != nil {
			if _, err := tx.Exec(ctx, `UPDATE message SET is_read = $2 WHERE thread_id = ANY($1) AND is_read <> $2`, changed, *c.IsRead); err != nil {
				return fmt.Errorf("mark read: %w", err)
			}
		}
		if c.IsStarred != nil {
			if err := star(ctx, tx, changed, *c.IsStarred); err != nil {
				return err
			}
		}
		if c.SnoozedUntil.Set {
			if _, err := tx.Exec(ctx, `UPDATE thread SET snoozed_until = $2 WHERE id = ANY($1)`, changed, c.SnoozedUntil.Ptr()); err != nil {
				return fmt.Errorf("snooze: %w", err)
			}
		}
		if len(add) > 0 {
			if _, err := tx.Exec(ctx, `INSERT INTO thread_label (thread_id, label_id)
				SELECT t, l FROM unnest($1::text[]) t, unnest($2::text[]) l ON CONFLICT DO NOTHING`, changed, add); err != nil {
				return fmt.Errorf("add labels: %w", err)
			}
		}
		if len(remove) > 0 {
			if _, err := tx.Exec(ctx, `DELETE FROM thread_label WHERE thread_id = ANY($1) AND label_id = ANY($2)`, changed, remove); err != nil {
				return fmt.Errorf("remove labels: %w", err)
			}
		}
		return recomputeAll(ctx, tx, changed)
	})
	if err != nil {
		return nil, err
	}
	s.threadsChanged(changed)
	return changed, nil
}

// move puts a thread's messages in folder. Drafts never move: the composer
// only looks for them in drafts. Neither does a draft claimed by a send in
// flight (folder 'drafts', is_draft false): the send records it as sent.
//
//   - trash: every message, remembering where it was for restore.
//   - inbox: received mail to inbox, our own mail back to sent.
//   - archive, spam: received mail moves; our own mail stays in sent (and
//     leaves the trash for sent).
func move(ctx context.Context, tx pgx.Tx, threadIDs []string, folder string) error {
	var sql string
	switch folder {
	case "trash":
		sql = `UPDATE message SET previous_folder = folder, folder = 'trash'
			WHERE thread_id = ANY($1) AND NOT is_draft AND folder NOT IN ('trash', 'drafts')`
	case "inbox":
		sql = `UPDATE message SET previous_folder = NULL,
			folder = CASE WHEN is_outbound THEN 'sent'::folder ELSE 'inbox'::folder END
			WHERE thread_id = ANY($1) AND NOT is_draft AND folder <> 'drafts'`
	default:
		sql = `UPDATE message SET previous_folder = NULL,
			folder = CASE WHEN is_outbound THEN 'sent'::folder ELSE $2::folder END
			WHERE thread_id = ANY($1) AND NOT is_draft AND folder <> 'drafts' AND (NOT is_outbound OR folder = 'trash')`
	}
	args := []any{threadIDs}
	if strings.Contains(sql, "$2") {
		args = append(args, folder)
	}
	if _, err := tx.Exec(ctx, sql, args...); err != nil {
		return fmt.Errorf("move to %s: %w", folder, err)
	}
	return nil
}

// star marks the newest message of each thread, Gmail-style; unstar
// clears every message.
func star(ctx context.Context, tx pgx.Tx, threadIDs []string, on bool) error {
	sql := `UPDATE message SET is_starred = false WHERE thread_id = ANY($1) AND is_starred`
	if on {
		sql = `UPDATE message SET is_starred = true WHERE id IN (
			SELECT DISTINCT ON (thread_id) id FROM message WHERE thread_id = ANY($1) AND NOT is_draft
			ORDER BY thread_id, received_at DESC, id DESC)`
	}
	if _, err := tx.Exec(ctx, sql, threadIDs); err != nil {
		return fmt.Errorf("star: %w", err)
	}
	return nil
}

func recomputeAll(ctx context.Context, q db.Querier, threadIDs []string) error {
	for _, id := range threadIDs {
		if err := Recompute(ctx, q, id); err != nil {
			return err
		}
	}
	return nil
}

// resolveLabels turns ids or names into ids. Unknown names are a 422.
func resolveLabels(ctx context.Context, q db.Querier, refs []string, param string) ([]string, error) {
	if len(refs) == 0 {
		return nil, nil
	}
	lower := make([]string, len(refs))
	for i, r := range refs {
		lower[i] = strings.ToLower(strings.TrimSpace(r))
	}
	rows, _ := q.Query(ctx, `SELECT id, lower(name) FROM label WHERE id = ANY($1) OR lower(name) = ANY($2)`, refs, lower)
	found := map[string]string{}
	var id, name string
	if _, err := pgx.ForEachRow(rows, []any{&id, &name}, func() error {
		found[id], found[name] = id, id
		return nil
	}); err != nil {
		return nil, fmt.Errorf("resolve labels: %w", err)
	}
	out := make([]string, 0, len(refs))
	for i, r := range refs {
		hit, ok := found[r]
		if !ok {
			hit, ok = found[lower[i]]
		}
		if !ok {
			return nil, httpx.Invalid(param, fmt.Sprintf("%s: No label called %q", param, r))
		}
		out = append(out, hit)
	}
	return out, nil
}

// RestoreThreads takes threads out of the trash, back where each message was.
func (s *Service) RestoreThreads(ctx context.Context, allowed, ids []string) ([]string, error) {
	var changed []string
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		var err error
		if changed, err = ownedThreads(ctx, tx, allowed, ids); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE message SET folder = coalesce(previous_folder,
				CASE WHEN is_outbound THEN 'sent'::folder ELSE 'inbox'::folder END), previous_folder = NULL
			WHERE thread_id = ANY($1) AND folder = 'trash' AND NOT is_draft`, changed); err != nil {
			return fmt.Errorf("restore: %w", err)
		}
		return recomputeAll(ctx, tx, changed)
	})
	if err != nil {
		return nil, err
	}
	s.threadsChanged(changed)
	return changed, nil
}

// Deleted reports one thread's fate.
type Deleted struct {
	Object    string `json:"object"`
	ID        string `json:"id"`
	Deleted   bool   `json:"deleted"`
	Permanent bool   `json:"permanent"`
}

// DeleteThreads moves threads to the trash, or deletes them for good when
// permanent is set or they are already only in the trash.
func (s *Service) DeleteThreads(ctx context.Context, allowed, ids []string, permanent bool) ([]Deleted, error) {
	var out []Deleted
	var keys []string
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		owned, err := ownedThreads(ctx, tx, allowed, ids)
		if err != nil {
			return err
		}
		if len(owned) == 0 {
			return httpx.NotFound("No such thread")
		}
		var purge, trash []string
		if permanent {
			purge = owned
		} else {
			rows, _ := tx.Query(ctx, `SELECT id, folders = '{trash}' FROM thread WHERE id = ANY($1)`, owned)
			var id string
			var onlyTrash bool
			if _, err := pgx.ForEachRow(rows, []any{&id, &onlyTrash}, func() error {
				if onlyTrash {
					purge = append(purge, id)
				} else {
					trash = append(trash, id)
				}
				return nil
			}); err != nil {
				return fmt.Errorf("classify threads: %w", err)
			}
		}
		if len(purge) > 0 {
			// A draft claimed by a send in flight stays (and so does its
			// thread): the send records it as sent.
			const cond = "m.thread_id = ANY($1) AND NOT (m.folder = 'drafts' AND NOT m.is_draft)"
			if keys, err = objectKeys(ctx, tx, cond, purge); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM message m WHERE `+cond, purge); err != nil {
				return fmt.Errorf("purge threads: %w", err)
			}
			if keys, err = unusedKeys(ctx, tx, keys); err != nil {
				return err
			}
			if err := recomputeAll(ctx, tx, purge); err != nil {
				return err
			}
		}
		if len(trash) > 0 {
			if err := move(ctx, tx, trash, "trash"); err != nil {
				return err
			}
			if err := recomputeAll(ctx, tx, trash); err != nil {
				return err
			}
		}
		for _, id := range purge {
			out = append(out, Deleted{"thread", id, true, true})
		}
		for _, id := range trash {
			out = append(out, Deleted{"thread", id, true, false})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.forget(keys)
	changed := make([]string, len(out))
	for i, d := range out {
		changed[i] = d.ID
	}
	s.threadsChanged(changed)
	return out, nil
}

// EmptyTrash deletes every message in the trash within reach and returns
// how many threads it touched.
func (s *Service) EmptyTrash(ctx context.Context, allowed []string, mailbox, domain string) (int, error) {
	var w where
	w.add("m.folder = 'trash'")
	w.scope("m.mailbox_id", allowed, mailbox, domain)
	var touched []string
	var keys []string
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		rows, _ := tx.Query(ctx, `SELECT DISTINCT m.thread_id FROM message m `+w.sql(), w.args...)
		var err error
		if touched, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return fmt.Errorf("find trash: %w", err)
		}
		if keys, err = objectKeys(ctx, tx, strings.TrimPrefix(w.sql(), "WHERE "), w.args...); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM message m `+w.sql(), w.args...); err != nil {
			return fmt.Errorf("empty trash: %w", err)
		}
		if keys, err = unusedKeys(ctx, tx, keys); err != nil {
			return err
		}
		return recomputeAll(ctx, tx, touched)
	})
	if err != nil {
		return 0, err
	}
	s.forget(keys)
	s.threadsChanged(touched)
	return len(touched), nil
}

// objectKeys lists the stored files (attachments, raw messages) of the
// messages matching cond, so they can be deleted from R2 after commit.
func objectKeys(ctx context.Context, q db.Querier, cond string, args ...any) ([]string, error) {
	rows, _ := q.Query(ctx, `SELECT a.r2_key FROM attachment a JOIN message m ON m.id = a.message_id WHERE `+cond+`
		UNION ALL SELECT m.raw_key FROM message m WHERE m.raw_key IS NOT NULL AND `+cond, args...)
	keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("collect object keys: %w", err)
	}
	return keys, nil
}

// unusedKeys keeps the keys no remaining row points at. One inbound
// payload stored for several mailboxes shares its files and raw message, so
// deleting one copy must leave them for the others. Call it after the
// delete, in the same transaction.
func unusedKeys(ctx context.Context, q db.Querier, keys []string) ([]string, error) {
	if len(keys) == 0 {
		return nil, nil
	}
	rows, _ := q.Query(ctx, `SELECT DISTINCT k FROM unnest($1::text[]) k
		WHERE NOT EXISTS (SELECT 1 FROM attachment WHERE r2_key = k) AND NOT EXISTS (SELECT 1 FROM message WHERE raw_key = k)`, keys)
	out, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("find unused object keys: %w", err)
	}
	return out, nil
}

// forget deletes stored files in the background. A failure leaves an
// orphan object, never a broken message, so it is logged and dropped.
func (s *Service) forget(keys []string) {
	if len(keys) == 0 || s.Store == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if err := s.Store.Delete(ctx, keys...); err != nil {
			slog.Warn("delete stored files failed", "count", len(keys), "err", err)
		}
	}()
}

func (s *Service) threadsChanged(ids []string) {
	if len(ids) == 0 {
		return
	}
	if s.Hub != nil {
		s.Hub.Publish(realtime.Event{Type: "thread.updated", Data: map[string]any{"thread_ids": ids}})
	}
}
