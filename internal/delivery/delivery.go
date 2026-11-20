package delivery

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/events"
	"github.com/shahriyardx/mails/internal/id"
	"github.com/shahriyardx/mails/internal/realtime"
	"github.com/shahriyardx/mails/internal/ses"
)

// Service records SES delivery events.
type Service struct {
	DB     *pgxpool.Pool
	SES    ses.Client
	Hub    *realtime.Hub
	Events events.Sink
	Now    func() time.Time
}

// SESEvent is the part of an SES event notification Mails reads.
type SESEvent struct {
	EventType        string `json:"eventType"`
	NotificationType string `json:"notificationType"`
	Mail             struct {
		MessageID   string   `json:"messageId"`
		Timestamp   string   `json:"timestamp"`
		Destination []string `json:"destination"`
	} `json:"mail"`
	Bounce *struct {
		BounceType        string `json:"bounceType"`
		BounceSubType     string `json:"bounceSubType"`
		BouncedRecipients []struct {
			EmailAddress   string `json:"emailAddress"`
			DiagnosticCode string `json:"diagnosticCode"`
		} `json:"bouncedRecipients"`
		Timestamp string `json:"timestamp"`
	} `json:"bounce"`
	Complaint *struct {
		ComplainedRecipients []struct {
			EmailAddress string `json:"emailAddress"`
		} `json:"complainedRecipients"`
		ComplaintFeedbackType string `json:"complaintFeedbackType"`
		Timestamp             string `json:"timestamp"`
	} `json:"complaint"`
	Delivery *struct {
		Recipients []string `json:"recipients"`
		Timestamp  string   `json:"timestamp"`
	} `json:"delivery"`
	DeliveryDelay *struct {
		DelayType string `json:"delayType"`
		Timestamp string `json:"timestamp"`
	} `json:"deliveryDelay"`
	Open *struct {
		Timestamp string `json:"timestamp"`
	} `json:"open"`
	Click *struct {
		Link      string `json:"link"`
		Timestamp string `json:"timestamp"`
	} `json:"click"`
	Reject *struct {
		Reason string `json:"reason"`
	} `json:"reject"`
}

// kinds maps an SES event name to the event_type enum, the delivery status
// it implies (if any) and the webhook it fires (if any). "Send" fires no
// webhook: the send path fires email.sent itself, config set or not.
var kinds = map[string]struct{ typ, status, webhook string }{
	"Send":             {"send", "sent", ""},
	"Delivery":         {"delivery", "delivered", "email.delivered"},
	"Bounce":           {"bounce", "bounced", "email.bounced"},
	"Complaint":        {"complaint", "complained", "email.complained"},
	"Reject":           {"reject", "rejected", "email.rejected"},
	"DeliveryDelay":    {"delivery_delay", "delayed", "email.delayed"},
	"RenderingFailure": {"rendering_failure", "failed", ""},
	"Open":             {"open", "", "email.opened"},
	"Click":            {"click", "", "email.clicked"},
}

// rank orders delivery statuses so a late or repeated event never moves a
// message backwards (a Send arriving after its Delivery, a delay after it
// was delivered).
const rank = `CASE %s WHEN 'queued' THEN 0 WHEN 'sent' THEN 1 WHEN 'delayed' THEN 2 WHEN 'delivered' THEN 3
	WHEN 'complained' THEN 4 WHEN 'bounced' THEN 4 WHEN 'rejected' THEN 4 WHEN 'failed' THEN 4 ELSE 0 END`

func (e *SESEvent) kind() string {
	if e.EventType != "" {
		return e.EventType
	}
	return e.NotificationType
}

func (e *SESEvent) when(now time.Time) time.Time {
	var stamps []string
	switch {
	case e.Bounce != nil:
		stamps = append(stamps, e.Bounce.Timestamp)
	case e.Complaint != nil:
		stamps = append(stamps, e.Complaint.Timestamp)
	case e.Delivery != nil:
		stamps = append(stamps, e.Delivery.Timestamp)
	case e.Open != nil:
		stamps = append(stamps, e.Open.Timestamp)
	case e.Click != nil:
		stamps = append(stamps, e.Click.Timestamp)
	case e.DeliveryDelay != nil:
		stamps = append(stamps, e.DeliveryDelay.Timestamp)
	}
	for _, s := range append(stamps, e.Mail.Timestamp) {
		if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
			return t
		}
	}
	return now
}

func (e *SESEvent) recipients() []string {
	var out []string
	switch {
	case e.Bounce != nil:
		for _, r := range e.Bounce.BouncedRecipients {
			out = append(out, r.EmailAddress)
		}
	case e.Complaint != nil:
		for _, r := range e.Complaint.ComplainedRecipients {
			out = append(out, r.EmailAddress)
		}
	case e.Delivery != nil:
		out = e.Delivery.Recipients
	default:
		out = e.Mail.Destination
	}
	var clean []string
	for _, a := range out {
		if a = strings.ToLower(strings.TrimSpace(a)); a != "" {
			clean = append(clean, a)
		}
	}
	return clean
}

func (e *SESEvent) detail() *string {
	var s string
	switch {
	case e.Bounce != nil:
		s = e.Bounce.BounceType + "/" + e.Bounce.BounceSubType
	case e.Complaint != nil:
		s = e.Complaint.ComplaintFeedbackType
		if s == "" {
			s = "complaint"
		}
	case e.DeliveryDelay != nil:
		s = e.DeliveryDelay.DelayType
	case e.Click != nil:
		s = e.Click.Link
	case e.Reject != nil:
		s = e.Reject.Reason
	}
	if s == "" {
		return nil
	}
	if len(s) > 2000 {
		s = s[:2000]
	}
	return &s
}

func (e *SESEvent) errorText() *string {
	switch {
	case e.Bounce != nil:
		for _, r := range e.Bounce.BouncedRecipients {
			if r.DiagnosticCode != "" {
				return &r.DiagnosticCode
			}
		}
		s := "Bounced: " + e.Bounce.BounceType + "/" + e.Bounce.BounceSubType
		return &s
	case e.Complaint != nil:
		s := "Recipient marked this as spam"
		return &s
	case e.Reject != nil:
		s := "SES rejected it: " + e.Reject.Reason
		return &s
	}
	return nil
}

// Record stores one SES event. snsID makes a redelivered notification a
// no-op. Unknown kinds and events for mail SES did not get from us are
// ignored.
func (s *Service) Record(ctx context.Context, snsID string, raw json.RawMessage) error {
	var e SESEvent
	if err := json.Unmarshal(raw, &e); err != nil {
		return fmt.Errorf("decode ses event: %w", err)
	}
	k, ok := kinds[e.kind()]
	if !ok || e.Mail.MessageID == "" {
		return nil
	}
	at := e.when(s.Now())
	recipients := e.recipients()
	var recipient *string
	if len(recipients) > 0 {
		recipient = &recipients[0]
	}

	var msgID, mailboxID string
	var duplicate bool
	err := pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT id, mailbox_id FROM message WHERE ses_message_id = $1`, e.Mail.MessageID).Scan(&msgID, &mailboxID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("find message: %w", err)
		}
		var msgRef *string
		if msgID != "" {
			msgRef = &msgID
		}
		var snsRef *string
		if snsID != "" {
			snsRef = &snsID
		}
		tag, err := tx.Exec(ctx, `INSERT INTO message_event (id, message_id, ses_message_id, type, recipient, detail, payload, occurred_at, sns_message_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (sns_message_id) WHERE sns_message_id IS NOT NULL DO NOTHING`,
			id.New("evt"), msgRef, e.Mail.MessageID, k.typ, recipient, e.detail(), raw, at, snsRef)
		if err != nil {
			return fmt.Errorf("insert event: %w", err)
		}
		if tag.RowsAffected() == 0 {
			duplicate = true
			return nil
		}
		if msgID == "" {
			return nil
		}
		if e.kind() == "Open" {
			if _, err := tx.Exec(ctx, `UPDATE message SET opened_at = coalesce(opened_at, $2), open_count = open_count + 1 WHERE id = $1`, msgID, at); err != nil {
				return fmt.Errorf("record open: %w", err)
			}
		}
		if k.status != "" {
			if _, err := tx.Exec(ctx, `UPDATE message SET delivery_status = $2::delivery_status, delivery_error = coalesce($3, delivery_error)
				WHERE id = $1 AND `+fmt.Sprintf(rank, "coalesce(delivery_status::text, '')")+` <= `+fmt.Sprintf(rank, "$2::text"),
				msgID, k.status, e.errorText()); err != nil {
				return fmt.Errorf("update status: %w", err)
			}
		}
		// A permanent bounce or a complaint means: stop mailing that address.
		if (e.Bounce != nil && e.Bounce.BounceType == "Permanent") || e.Complaint != nil {
			reason := "complaint"
			if e.Bounce != nil {
				reason = "bounce: " + *e.detail()
			}
			for _, a := range recipients {
				if _, err := tx.Exec(ctx, `INSERT INTO suppression (id, address, reason) VALUES ($1, $2, $3) ON CONFLICT (address) DO NOTHING`,
					id.New("sup"), a, reason); err != nil {
					return fmt.Errorf("suppress: %w", err)
				}
			}
		}
		return nil
	})
	if err != nil || duplicate || msgID == "" {
		return err
	}
	s.Hub.Publish(realtime.Event{Type: "message.updated", Data: map[string]string{"message_id": msgID}})
	if k.webhook != "" {
		s.emit(ctx, k.webhook, msgID, mailboxID, recipients, e.detail(), at)
	}
	return nil
}

func (s *Service) emit(ctx context.Context, event, msgID, mailboxID string, recipients []string, detail *string, at time.Time) {
	if s.Events == nil {
		return
	}
	var email struct {
		ID           string          `json:"id"`
		ThreadID     string          `json:"thread_id"`
		MailboxID    string          `json:"mailbox_id"`
		Mailbox      string          `json:"mailbox"`
		SESMessageID *string         `json:"ses_message_id"`
		MessageID    *string         `json:"message_id"`
		From         string          `json:"from"`
		To           json.RawMessage `json:"to"`
		Subject      string          `json:"subject"`
		Status       *string         `json:"status"`
	}
	err := s.DB.QueryRow(ctx, `SELECT m.id, m.thread_id, m.mailbox_id, mb.address, m.ses_message_id, m.rfc_message_id,
		m.from_address, m.to_addrs, m.subject, m.delivery_status::text FROM message m JOIN mailbox mb ON mb.id = m.mailbox_id WHERE m.id = $1`, msgID).
		Scan(&email.ID, &email.ThreadID, &email.MailboxID, &email.Mailbox, &email.SESMessageID, &email.MessageID,
			&email.From, &email.To, &email.Subject, &email.Status)
	if err != nil {
		slog.Error("load message for webhook", "event", event, "err", err)
		return
	}
	if recipients == nil {
		recipients = []string{}
	}
	s.Events.Emit(ctx, events.Event{Type: event, MailboxID: mailboxID, Data: map[string]any{
		"email": email, "recipients": recipients, "detail": detail, "occurred_at": at.UTC().Format(time.RFC3339),
	}})
}
