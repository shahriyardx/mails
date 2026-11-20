// Package seed fills an instance with demo mail for trying the dashboard
// and taking screenshots. Every demo message carries a Message-ID on
// Tag, so Remove takes out exactly what Demo put in.
package seed

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/id"
	"github.com/shahriyardx/mails/internal/inbound"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/realtime"
)

// Tag marks demo mail; .invalid can never be a real domain.
const Tag = "seed-demo.mails.invalid"

type letter struct {
	from    addr.Address
	subject string
	text    string
	minutes int    // how long ago
	reply   string // our answer, if any
	star    bool
	label   string
	folder  string // a filter-like move after arrival
}

var letters = []letter{
	{addr.Address{Name: "Ada Lovelace", Address: "ada@analytical.example"}, "Notes on the engine",
		"Hi,\n\nI've finished the notes on the engine. The table of Bernoulli numbers is in section G.\n\nAda", 12,
		"Thank you, Ada. Reading them tonight.", true, "Projects", ""},
	{addr.Address{Name: "Grace Hopper", Address: "grace@navy.example"}, "Found a bug (an actual moth)",
		"Taped it into the log book. First actual case of a bug being found.\n\nGrace", 95, "", false, "", ""},
	{addr.Address{Name: "Billing", Address: "billing@hosting.example"}, "Your invoice for November",
		"Your invoice INV-4821 for 12.00 USD is ready. It will be charged on the 1st.", 300, "", false, "Receipts", "archive"},
	{addr.Address{Name: "Linus", Address: "linus@kernel.example"}, "Re: patch review",
		"Looks fine to me. Please split the second commit and resend.\n\nLinus", 720,
		"Done, v2 is out.", false, "Projects", ""},
	{addr.Address{Name: "Prize Office", Address: "winner@lottery.example"}, "You have WON 1,000,000",
		"Send your bank details to claim your prize today!!!", 1440, "", false, "", "spam"},
	{addr.Address{Name: "Margaret Hamilton", Address: "margaret@apollo.example"}, "Priority displays",
		"The alarms during descent were the computer doing its job: dropping low-priority work.\n\nMargaret", 2900,
		"", true, "", ""},
	{addr.Address{Name: "Newsletter", Address: "news@weekly.example"}, "This week in mail",
		"Five things about SPF, DKIM and DMARC you should know.", 4400, "", false, "", "archive"},
}

// Demo adds demo mail to mailboxID (or the first mailbox, created on
// demo.invalid if there is none) and returns how many messages it added.
func Demo(ctx context.Context, pool *pgxpool.Pool, mailboxID string, now time.Time) (int, error) {
	box, err := pickMailbox(ctx, pool, mailboxID)
	if err != nil {
		return 0, err
	}
	in := &inbound.Service{DB: pool, Hub: realtime.NewHub(), Now: func() time.Time { return now }}
	added := 0
	for i, l := range letters {
		at := now.Add(-time.Duration(l.minutes) * time.Minute).Format(time.RFC3339)
		msgID := fmt.Sprintf("<demo-%d@%s>", i, Tag)
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM message WHERE mailbox_id = $1 AND rfc_message_id = $2)`,
			box.id, msgID).Scan(&exists); err != nil {
			return added, err
		}
		if exists {
			continue // seeded before
		}
		text := l.text
		res, err := in.Ingest(ctx, &inbound.Payload{
			To: box.address, From: l.from, ToAddresses: []addr.Address{{Name: box.name, Address: box.address}},
			Subject: l.subject, Text: &text, MessageID: &msgID, Date: &at,
		}, nil)
		if err != nil {
			return added, err
		}
		if len(res.Stored) == 0 {
			return added, fmt.Errorf("%s did not accept demo mail", box.address)
		}
		added++
		if err := finish(ctx, pool, box, l, res.Stored[0], i, now); err != nil {
			return added, err
		}
		if l.reply != "" {
			added++
		}
	}
	return added, nil
}

type mailboxRow struct{ id, address, name string }

func pickMailbox(ctx context.Context, pool *pgxpool.Pool, mailboxID string) (mailboxRow, error) {
	var b mailboxRow
	err := pool.QueryRow(ctx, `SELECT id, address, display_name FROM mailbox WHERE ($1 = '' OR id = $1 OR address = lower($1))
		ORDER BY is_default DESC, created_at LIMIT 1`, mailboxID).Scan(&b.id, &b.address, &b.name)
	if err == nil {
		return b, nil
	}
	if err != pgx.ErrNoRows {
		return b, fmt.Errorf("find mailbox: %w", err)
	}
	if mailboxID != "" {
		return b, fmt.Errorf("no mailbox %q", mailboxID)
	}
	// An empty instance: make a demo mailbox on a domain that cannot exist.
	b = mailboxRow{id.New("mbx"), "hello@demo.invalid", "Demo"}
	_, err = pool.Exec(ctx, `INSERT INTO mailbox (id, address, domain, display_name, is_default, color) VALUES ($1, $2, 'demo.invalid', $3, true, $4)`,
		b.id, b.address, b.name, addr.Color(b.address))
	return b, err
}

// finish applies what a person would have done: star, label, move, reply.
func finish(ctx context.Context, pool *pgxpool.Pool, box mailboxRow, l letter, msgID string, i int, now time.Time) error {
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		var threadID string
		if err := tx.QueryRow(ctx, `SELECT thread_id FROM message WHERE id = $1`, msgID).Scan(&threadID); err != nil {
			return err
		}
		if l.star {
			if _, err := tx.Exec(ctx, `UPDATE message SET is_starred = true WHERE id = $1`, msgID); err != nil {
				return err
			}
		}
		if l.folder != "" {
			if _, err := tx.Exec(ctx, `UPDATE message SET folder = $2::folder, is_read = true WHERE id = $1`, msgID, l.folder); err != nil {
				return err
			}
		}
		if l.label != "" {
			labelID := id.New("lbl")
			if err := tx.QueryRow(ctx, `INSERT INTO label (id, name) VALUES ($1, $2)
				ON CONFLICT (name) DO UPDATE SET name = excluded.name RETURNING id`, labelID, l.label).Scan(&labelID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO thread_label (thread_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, threadID, labelID); err != nil {
				return err
			}
		}
		if l.reply != "" {
			at := now.Add(-time.Duration(l.minutes-5) * time.Minute)
			to := []addr.Address{l.from}
			if _, err := tx.Exec(ctx, `UPDATE message SET is_read = true WHERE id = $1`, msgID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO message (id, thread_id, mailbox_id, rfc_message_id, in_reply_to, from_name, from_address,
					to_addrs, subject, snippet, text_body, folder, is_outbound, is_read, delivery_status, sent_at, received_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'sent', true, true, 'delivered', $12, $12)`,
				id.New("msg"), threadID, box.id, fmt.Sprintf("<demo-reply-%d@%s>", i, Tag), fmt.Sprintf("<demo-%d@%s>", i, Tag),
				box.name, box.address, to, addr.ReplySubject(l.subject), addr.Snippet(l.reply, ""), l.reply, at); err != nil {
				return err
			}
		}
		return mail.Recompute(ctx, tx, threadID)
	})
}

// Remove deletes every demo message (and threads left empty).
func Remove(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	var removed int
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		rows, _ := tx.Query(ctx, `DELETE FROM message WHERE rfc_message_id LIKE '%@' || $1 || '>' RETURNING thread_id`, Tag)
		threads, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		removed = len(threads)
		seen := map[string]bool{}
		for _, t := range threads {
			if !seen[t] {
				seen[t] = true
				if err := mail.Recompute(ctx, tx, t); err != nil {
					return err
				}
			}
		}
		_, err = tx.Exec(ctx, `DELETE FROM mailbox WHERE domain = 'demo.invalid' AND NOT EXISTS (SELECT 1 FROM message m WHERE m.mailbox_id = mailbox.id)`)
		return err
	})
	return removed, err
}
