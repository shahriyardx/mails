package send

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/realtime"
	"github.com/shahriyardx/mails/internal/ses"
)

const (
	backoffBase = 30 * time.Second
	backoffMax  = 15 * time.Minute
	// A job held longer than this was claimed by a process that died.
	staleLock = 10 * time.Minute
	idlePoll  = 30 * time.Second
)

// Backoff is the wait after the given attempt: 30s doubling to 15m, with
// ±20% jitter so jobs queued by one outage do not all wake together.
func Backoff(attempt int) time.Duration {
	d := backoffBase << max(0, attempt-1)
	if d > backoffMax || d <= 0 {
		d = backoffMax
	}
	return time.Duration(float64(d) * (0.8 + rand.Float64()*0.4))
}

func (s *Service) wakeCh() chan struct{} {
	s.once.Do(func() { s.wake = make(chan struct{}, 1) })
	return s.wake
}

// Wake nudges the outbox worker to look for due jobs now.
func (s *Service) Wake() {
	select {
	case s.wakeCh() <- struct{}{}:
	default:
	}
}

// RunOutbox processes due jobs until ctx ends. Jobs are claimed with
// FOR UPDATE SKIP LOCKED, so several processes can run it safely. Between
// rounds it sleeps until the next job is due (an undo window ending, a
// retry), at most idlePoll, or until Wake.
func (s *Service) RunOutbox(ctx context.Context) {
	wake := s.wakeCh()
	t := time.NewTimer(idlePoll)
	defer t.Stop()
	for {
		for ctx.Err() == nil {
			worked, err := s.ProcessOne(ctx)
			if err != nil {
				slog.Error("outbox", "err", err)
				break
			}
			if !worked {
				break
			}
		}
		t.Reset(s.untilNextDue(ctx))
		select {
		case <-ctx.Done():
			return
		case <-wake:
		case <-t.C:
		}
	}
}

// untilNextDue is how long until the earliest pending job is due, within
// [minWait, idlePoll]. The floor keeps a job another process holds from
// spinning this loop.
func (s *Service) untilNextDue(ctx context.Context) time.Duration {
	const minWait = 200 * time.Millisecond
	var next *time.Time
	if err := s.DB.QueryRow(ctx, `SELECT min(next_attempt_at) FROM send_job WHERE status = 'pending'`).Scan(&next); err != nil || next == nil {
		return idlePoll
	}
	return min(max(next.Sub(s.Now()), minWait), idlePoll)
}

type job struct {
	ID, MessageID, From string
	Recipients          []string
	Raw                 []byte
	Attempts, Max       int
}

// ProcessOne claims and sends one due job. It reports whether there was one.
func (s *Service) ProcessOne(ctx context.Context) (bool, error) {
	if _, err := s.DB.Exec(ctx, `UPDATE send_job SET status = 'pending', locked_at = NULL
		WHERE status = 'sending' AND locked_at < $1`, s.Now().Add(-staleLock)); err != nil {
		return false, fmt.Errorf("release stale jobs: %w", err)
	}
	var j job
	err := s.DB.QueryRow(ctx, `UPDATE send_job SET status = 'sending', locked_at = $1, attempts = attempts + 1, updated_at = $1
		WHERE id = (SELECT id FROM send_job WHERE status = 'pending' AND next_attempt_at <= $1
			ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1)
		RETURNING id, message_id, from_address, recipients, raw_mime, attempts, max_attempts`, s.Now()).
		Scan(&j.ID, &j.MessageID, &j.From, &j.Recipients, &j.Raw, &j.Attempts, &j.Max)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim job: %w", err)
	}

	// The job is claimed: shutdown must neither abort the SES call (SES may
	// have taken the mail, and the retry would send it twice) nor stop the
	// record, or a restart would send the job again.
	sendCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), sesTimeout)
	sesID, sendErr := s.SES.SendRaw(sendCtx, ses.RawEmail{From: j.From, To: j.Recipients, Raw: j.Raw, ConfigurationSet: s.configSet()})
	cancel()
	ctx, cancelFin := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancelFin()

	var event string
	switch {
	case sendErr == nil:
		event = "email.sent"
		err = pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
			// The bytes are not needed once SES has them.
			if _, err := tx.Exec(ctx, `UPDATE send_job SET status = 'sent', raw_mime = '', locked_at = NULL, last_error = NULL, updated_at = $2 WHERE id = $1`, j.ID, s.Now()); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `UPDATE message SET delivery_status = 'sent', ses_message_id = $2, rfc_message_id = $4, delivery_error = NULL, sent_at = $3 WHERE id = $1`,
				j.MessageID, sesID, s.Now(), s.wireID(sesID))
			return err
		})
	case ses.Permanent(sendErr) || j.Attempts >= j.Max:
		event = "email.failed"
		err = s.giveUp(ctx, j, sendErr.Error())
	default:
		_, err = s.DB.Exec(ctx, `WITH j AS (UPDATE send_job SET status = 'pending', locked_at = NULL, last_error = $2,
				next_attempt_at = $3, updated_at = now() WHERE id = $1 RETURNING message_id)
			UPDATE message SET delivery_error = $2 FROM j WHERE message.id = j.message_id`,
			j.ID, truncate(sendErr.Error()), s.Now().Add(Backoff(j.Attempts)))
	}
	if err != nil {
		return true, fmt.Errorf("finish job %s: %w", j.ID, err)
	}
	if event != "" {
		s.emitEmail(ctx, event, j.MessageID)
		s.publishMessage(ctx, j.MessageID)
	}
	return true, nil
}

func (s *Service) giveUp(ctx context.Context, j job, reason string) error {
	return pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE send_job SET status = 'failed', raw_mime = '', locked_at = NULL, last_error = $2, updated_at = now() WHERE id = $1`,
			j.ID, truncate(reason)); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE message SET delivery_status = 'failed', delivery_error = $2 WHERE id = $1`, j.MessageID, truncate(reason))
		return err
	})
}

func (s *Service) publishMessage(ctx context.Context, messageID string) {
	var threadID string
	if err := s.DB.QueryRow(ctx, `SELECT thread_id FROM message WHERE id = $1`, messageID).Scan(&threadID); err == nil {
		s.Hub.Publish(realtime.Event{Type: "thread.updated", Data: map[string]any{"thread_ids": []string{threadID}}})
	}
}

// Cancel calls off a message still waiting in the queue. Within its undo
// window a dashboard send turns back into a draft; any other waiting job is
// marked canceled. Once a worker has claimed it, or an undo window has
// passed, it is on its way and cancel is a 409.
func (s *Service) Cancel(ctx context.Context, allowed []string, messageID string) error {
	var id, mailboxID, status string
	var undoUntil *time.Time
	var attempts int
	err := s.DB.QueryRow(ctx, `SELECT m.id, m.mailbox_id, coalesce(j.status::text, ''), j.undo_until, coalesce(j.attempts, 0) FROM message m
		LEFT JOIN send_job j ON j.message_id = m.id WHERE m.id = $1 OR m.ses_message_id = $1 LIMIT 1`, messageID).
		Scan(&id, &mailboxID, &status, &undoUntil, &attempts)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && allowed != nil && !contains(allowed, mailboxID)) {
		return httpx.NotFound("No such email")
	}
	if err != nil {
		return fmt.Errorf("load job: %w", err)
	}
	if status != "pending" {
		return httpx.Conflict("This email is not waiting in the queue, so it cannot be called off")
	}
	if undoUntil != nil && attempts == 0 {
		return s.undo(ctx, id)
	}
	tag, err := s.DB.Exec(ctx, `WITH j AS (UPDATE send_job SET status = 'canceled', raw_mime = '', updated_at = now()
			WHERE message_id = $1 AND status = 'pending' RETURNING message_id)
		UPDATE message SET delivery_status = 'canceled' FROM j WHERE message.id = j.message_id`, id)
	if err != nil {
		return fmt.Errorf("cancel: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return httpx.Conflict("A worker picked this email up a moment ago")
	}
	s.emitEmail(ctx, "email.canceled", id)
	s.publishMessage(ctx, id)
	return nil
}

// undo turns a send still inside its undo window back into the draft it
// was: same id, thread and files. Nothing was announced for it, so no
// event goes out either.
func (s *Service) undo(ctx context.Context, id string) error {
	var threadID string
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		// The same row lock as the outbox claim: whichever comes first wins.
		tag, err := tx.Exec(ctx, `DELETE FROM send_job WHERE message_id = $1 AND status = 'pending' AND attempts = 0 AND undo_until > $2`, id, s.Now())
		if err != nil {
			return fmt.Errorf("undo: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return httpx.Conflict("Too late to undo: this email is on its way")
		}
		if err := tx.QueryRow(ctx, `UPDATE message SET folder = 'drafts', is_draft = true, delivery_status = NULL, delivery_error = NULL,
				rfc_message_id = NULL, sent_at = NULL, size_bytes = 0 WHERE id = $1 RETURNING thread_id`, id).Scan(&threadID); err != nil {
			return fmt.Errorf("undo: back to draft: %w", err)
		}
		return mail.Recompute(ctx, tx, threadID)
	})
	if err != nil {
		return err
	}
	s.Hub.Publish(realtime.Event{Type: "thread.updated", Data: map[string]any{"thread_ids": []string{threadID}}})
	return nil
}

func truncate(s string) string {
	if len(s) > 2000 {
		return s[:2000]
	}
	return s
}
