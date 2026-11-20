package send

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/id"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/realtime"
)

// SaveDraft creates a draft (empty DraftID) or replaces one. Staged files
// named in AttachmentIDs move onto it. Returns the draft's message id.
func (s *Service) SaveDraft(ctx context.Context, in Input) (*Result, error) {
	p, err := s.prepare(ctx, &in, true)
	if err != nil {
		return nil, err
	}
	msgID, threadID := in.DraftID, p.thread
	var current string // the draft's thread before this save
	var dropped []string
	err = pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if msgID != "" {
			err := tx.QueryRow(ctx, `SELECT thread_id FROM message WHERE id = $1 AND is_draft FOR UPDATE`, msgID).Scan(&current)
			if err == pgx.ErrNoRows {
				return httpx.NotFound("No such draft")
			}
			if err != nil {
				return fmt.Errorf("load draft: %w", err)
			}
			// Keep the draft's thread unless From moved it to another
			// mailbox: a thread's messages all share its mailbox, which every
			// reach check relies on.
			if threadID == "" {
				var sameBox bool
				if err := tx.QueryRow(ctx, `SELECT mailbox_id = $2 FROM thread WHERE id = $1`, current, p.box.ID).Scan(&sameBox); err != nil {
					return fmt.Errorf("load draft thread: %w", err)
				}
				if sameBox {
					threadID = current
				}
			}
		}
		if threadID == "" {
			threadID = id.New("thr")
			if _, err := tx.Exec(ctx, `INSERT INTO thread (id, mailbox_id, subject, last_message_at) VALUES ($1, $2, $3, $4)`,
				threadID, p.box.ID, in.Subject, s.Now()); err != nil {
				return fmt.Errorf("insert draft thread: %w", err)
			}
		}
		args := []any{msgID, threadID, p.box.ID, nilIfEmpty(in.InReplyTo), nonNil(in.References), p.from.Name, p.box.Address,
			addrs(in.To), addrs(in.Cc), addrs(in.Bcc), nilIfEmpty(in.ReplyTo), in.Subject, addr.Snippet(p.text, p.html),
			nilIfEmpty(in.Text), nilIfEmpty(in.HTML), s.Now()}
		if msgID == "" {
			msgID = id.New("msg")
			args[0] = msgID
			if _, err := tx.Exec(ctx, `INSERT INTO message (id, thread_id, mailbox_id, in_reply_to, "references", from_name, from_address,
					to_addrs, cc_addrs, bcc_addrs, reply_to, subject, snippet, text_body, html_body, received_at, folder, is_draft, is_outbound, is_read)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'drafts', true, true, true)`, args...); err != nil {
				return fmt.Errorf("insert draft: %w", err)
			}
		} else {
			if _, err := tx.Exec(ctx, `UPDATE message SET thread_id = $2, mailbox_id = $3, in_reply_to = $4, "references" = $5,
					from_name = $6, from_address = $7, to_addrs = $8, cc_addrs = $9, bcc_addrs = $10, reply_to = $11, subject = $12,
					snippet = $13, text_body = $14, html_body = $15, received_at = $16 WHERE id = $1`, args...); err != nil {
				return fmt.Errorf("update draft: %w", err)
			}
		}
		if err := attachFiles(ctx, tx, msgID, true, p.staged, &dropped); err != nil {
			return err
		}
		// A draft moved to another thread leaves its old one to recount
		// (Recompute deletes it if nothing is left).
		if current != "" && current != threadID {
			if err := mail.Recompute(ctx, tx, current); err != nil {
				return err
			}
		}
		return mail.Recompute(ctx, tx, threadID)
	})
	if err != nil {
		return nil, err
	}
	s.forgetFiles(dropped)
	s.Hub.Publish(realtime.Event{Type: "thread.updated", Data: map[string]any{"thread_ids": []string{threadID}}})
	return &Result{ID: msgID, ThreadID: threadID, From: p.box.Address, To: addr.Addresses(in.To), Subject: in.Subject, Status: "draft"}, nil
}

// DeleteDraft discards a draft and its files.
func (s *Service) DeleteDraft(ctx context.Context, allowed []string, draftID string) error {
	var threadID, mailboxID string
	err := s.DB.QueryRow(ctx, `SELECT thread_id, mailbox_id FROM message WHERE id = $1 AND is_draft`, draftID).Scan(&threadID, &mailboxID)
	if err == pgx.ErrNoRows || (err == nil && allowed != nil && !contains(allowed, mailboxID)) {
		return httpx.NotFound("No such draft")
	}
	if err != nil {
		return fmt.Errorf("load draft: %w", err)
	}
	var keys []string
	err = pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		rows, _ := tx.Query(ctx, `DELETE FROM attachment WHERE message_id = $1 RETURNING r2_key`, draftID)
		var err error
		if keys, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return fmt.Errorf("delete draft files: %w", err)
		}
		if _, err := tx.Exec(ctx, `DELETE FROM message WHERE id = $1`, draftID); err != nil {
			return fmt.Errorf("delete draft: %w", err)
		}
		return mail.Recompute(ctx, tx, threadID)
	})
	if err != nil {
		return err
	}
	if len(keys) > 0 {
		if err := s.Store.Delete(context.WithoutCancel(ctx), keys...); err != nil {
			return fmt.Errorf("delete draft files: %w", err)
		}
	}
	s.Hub.Publish(realtime.Event{Type: "thread.updated", Data: map[string]any{"thread_ids": []string{threadID}}})
	return nil
}
