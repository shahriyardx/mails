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
	html    string // optional HTML body (newsletters, receipts)
}

func who(name, address string) addr.Address { return addr.Address{Name: name, Address: address} }

// letters never change order: a letter's index is its Message-ID, so a
// second seed-demo adds only the new ones. Append; do not reorder.
var letters = []letter{
	{from: who("Ada Lovelace", "ada@analytical.example"), subject: "Notes on the engine", minutes: 12,
		text:  "Hi,\n\nI've finished the notes on the engine. The table of Bernoulli numbers is in section G.\n\nAda",
		reply: "Thank you, Ada. Reading them tonight.", star: true, label: "Projects"},
	{from: who("Grace Hopper", "grace@navy.example"), subject: "Found a bug (an actual moth)", minutes: 95,
		text: "Taped it into the log book. First actual case of a bug being found.\n\nGrace"},
	{from: who("Billing", "billing@hosting.example"), subject: "Your invoice for November", minutes: 300,
		text: "Your invoice INV-4821 for 12.00 USD is ready. It will be charged on the 1st.", label: "Receipts", folder: "archive"},
	{from: who("Linus", "linus@kernel.example"), subject: "Re: patch review", minutes: 720,
		text:  "Looks fine to me. Please split the second commit and resend.\n\nLinus",
		reply: "Done, v2 is out.", label: "Projects"},
	{from: who("Prize Office", "winner@lottery.example"), subject: "You have WON 1,000,000", minutes: 1440,
		text: "Send your bank details to claim your prize today!!!", folder: "spam"},
	{from: who("Margaret Hamilton", "margaret@apollo.example"), subject: "Priority displays", minutes: 2900, star: true,
		text: "The alarms during descent were the computer doing its job: dropping low-priority work.\n\nMargaret"},
	{from: who("Newsletter", "news@weekly.example"), subject: "This week in mail", minutes: 4400, folder: "archive",
		text: "Five things about SPF, DKIM and DMARC you should know."},

	// Real senders, so sender pictures (Gravatar, brand logos, site icons) show.
	{from: who("GitHub", "notifications@github.com"), subject: "[shahriyardx/mails] CI passed on main", minutes: 4,
		text: "All checks have passed.\n\nbuild (ubuntu-latest) 2m 31s\ntest (postgres 18) 1m 58s\nlint 21s"},
	{from: who("Stripe", "receipts@stripe.com"), subject: "Your receipt from Cloud Hosting #2041-7781", minutes: 38, label: "Receipts",
		text: "Amount paid: $24.00\nDate paid: today\nPayment method: Visa ending 4242",
		html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #e6e4ee;border-radius:12px">
<p style="color:#7e7b8a;font-size:13px;margin:0">Receipt #2041-7781</p>
<h1 style="font-size:28px;margin:8px 0 16px">$24.00</h1>
<table style="width:100%;font-size:14px;border-collapse:collapse">
<tr><td style="padding:8px 0;color:#7e7b8a">Cloud Hosting, Pro plan</td><td style="text-align:right">$20.00</td></tr>
<tr><td style="padding:8px 0;color:#7e7b8a">Extra storage, 50 GB</td><td style="text-align:right">$4.00</td></tr>
<tr><td style="padding:8px 0;border-top:1px solid #e6e4ee;font-weight:600">Total</td><td style="text-align:right;border-top:1px solid #e6e4ee;font-weight:600">$24.00</td></tr>
</table>
<p style="font-size:13px;color:#7e7b8a;margin-top:20px">Paid with Visa ending 4242.</p></div>`},
	{from: who("Vercel", "notifications@vercel.com"), subject: "Deployment ready: mails-docs", minutes: 140,
		text: "Your deployment is ready.\n\nProject: mails-docs\nBranch: main\nCommit: 8a91686 web: keep quick actions on the open list row"},
	{from: who("Linear", "notifications@linear.app"), subject: "MAIL-42 Draft card shows Edit button", minutes: 210, label: "Projects",
		text: "Shahriyar moved MAIL-42 from In Progress to Done.\n\nDraft card shows Edit and Discard without expanding it."},
	{from: who("Cloudflare", "noreply@notify.cloudflare.com"), subject: "Email Routing is active on your domain", minutes: 1500,
		text: "Mail sent to your domain now reaches your Email Worker. You can change routes any time in the dashboard."},
	{from: who("Figma", "no-reply@figma.com"), subject: "Alex commented on Mails, dashboard v3", minutes: 1620,
		text: "\"The list feels much calmer now. Can the day labels be a touch lighter?\""},
	{from: who("Amazon Web Services", "no-reply-aws@amazon.com"), subject: "Amazon SES: production access granted", minutes: 3000, star: true,
		text: "Your account is out of the SES sandbox in us-east-1. You can now send to any address, up to 50,000 messages a day."},
	{from: who("Nadia Rahman", "nadia@studio.example"), subject: "Logo files and a question about Friday", minutes: 26,
		text:  "Hey!\n\nAttached the final logo set. Are we still on for Friday at 3? I can bring the printed proofs.\n\nNadia",
		reply: "Friday at 3 works. See you then!", label: "Projects"},
	{from: who("Product Weekly", "hello@productweekly.example"), subject: "Issue #118: Calm software", minutes: 5800,
		text: "Calm software: why the best tools say less.",
		html: `<div style="font-family:Georgia,serif;max-width:560px;margin:auto;color:#1b1a22">
<p style="font:600 12px system-ui;letter-spacing:.08em;color:#6b5bd6;text-transform:uppercase">Issue #118</p>
<h1 style="font-size:30px;line-height:1.15;margin:6px 0 14px">Calm software: why the best tools say less</h1>
<p style="font-size:17px;line-height:1.6">Every label, badge and counter asks for attention. This week we look at three apps that removed half their interface and got easier to use.</p>
<h2 style="font-size:20px;margin-top:24px">1. Say each thing once</h2>
<p style="font-size:17px;line-height:1.6">If a switch shows it is off, the word "Off" next to it is noise.</p>
<h2 style="font-size:20px;margin-top:24px">2. Hide what you rarely need</h2>
<p style="font-size:17px;line-height:1.6">Settings you change once a year do not belong on the main screen.</p>
<p style="font:13px system-ui;color:#7e7b8a;margin-top:28px">You get this because you subscribed at productweekly.example.</p></div>`},
	{from: who("Sam Okafor", "sam@okafor.example"), subject: "Dinner on Saturday?", minutes: 8,
		text: "We're doing dinner at ours on Saturday around 7. Bring nothing but yourself. Let me know!\n\nSam"},
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
			Subject: l.subject, Text: &text, HTML: nilIfEmpty(l.html), MessageID: &msgID, Date: &at,
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
				ON CONFLICT (lower(name)) DO UPDATE SET name = label.name RETURNING id`, labelID, l.label).Scan(&labelID); err != nil {
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

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
