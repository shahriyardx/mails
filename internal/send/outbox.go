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
// FOR UPDATE SKIP LOCKED, so several processes can run it safely.
func (s *Service) RunOutbox(ctx context.Context) {
	wake := s.wakeCh()
	t := time.NewTicker(idlePoll)
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
		select {
		case <-ctx.Done():
			return
		case <-wake:
		case <-t.C:
		}
	}
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

	sendCtx, cancel := context.WithTimeout(ctx, sesTimeout)
	sesID, sendErr := s.SES.SendRaw(sendCtx, ses.RawEmail{From: j.From, To: j.Recipients, Raw: j.Raw, ConfigurationSet: s.configSet()})
	cancel()
	// SES has answered: record it even if shutdown began meanwhile, or a
	// restart would send the job again.
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
			_, err := tx.Exec(ctx, `UPDATE message SET delivery_status = 'sent', ses_message_id = $2, delivery_error = NULL, sent_at = $3 WHERE id = $1`,
				j.MessageID, sesID, s.Now())
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

// Cancel calls off a message still waiting in the queue. Once a worker has
// claimed it, it is on its way and cancel is a 409.
func (s *Service) Cancel(ctx context.Context, allowed []string, messageID string) error {
	var mailboxID, status string
	err := s.DB.QueryRow(ctx, `SELECT m.mailbox_id, coalesce(j.status::text, '') FROM message m
		LEFT JOIN send_job j ON j.message_id = m.id WHERE m.id = $1 OR m.ses_message_id = $1`, messageID).Scan(&mailboxID, &status)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && allowed != nil && !contains(allowed, mailboxID)) {
		return httpx.NotFound("No such email")
	}
	if err != nil {
		return fmt.Errorf("load job: %w", err)
	}
	if status != "pending" {
		return httpx.Conflict("This email is not waiting in the queue, so it cannot be called off")
	}
	tag, err := s.DB.Exec(ctx, `WITH j AS (UPDATE send_job SET status = 'canceled', raw_mime = '', updated_at = now()
			WHERE message_id = (SELECT id FROM message WHERE id = $1 OR ses_message_id = $1) AND status = 'pending' RETURNING message_id)
		UPDATE message SET delivery_status = 'canceled' FROM j WHERE message.id = j.message_id`, messageID)
	if err != nil {
		return fmt.Errorf("cancel: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return httpx.Conflict("A worker picked this email up a moment ago")
	}
	var id string
	_ = s.DB.QueryRow(ctx, `SELECT id FROM message WHERE id = $1 OR ses_message_id = $1`, messageID).Scan(&id)
	s.emitEmail(ctx, "email.canceled", id)
	s.publishMessage(ctx, id)
	return nil
}

func truncate(s string) string {
	if len(s) > 2000 {
		return s[:2000]
	}
	return s
}
