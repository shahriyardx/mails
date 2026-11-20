// Package forwarding decides where inbound mail is copied, and manages the
// destination addresses and rules behind that decision.
//
// A rule sits at one of three widths: one mailbox, one domain, or the whole
// instance. A message picks up rules from its mailbox outwards; forward_off on
// the mailbox or the domain stops the walk there. Only destinations Cloudflare
// has verified are returned, since the worker can forward to nothing else.
package forwarding

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/db"
)

// ForMailbox returns the addresses mail delivered to a mailbox is copied to.
func ForMailbox(ctx context.Context, q db.Querier, mailboxID string) ([]string, error) {
	return collect(ctx, q, `
SELECT DISTINCT fa.address FROM forward_rule fr
JOIN forward_address fa ON fa.id = fr.address_id
JOIN mailbox m ON m.id = $1
LEFT JOIN domain d ON d.id = m.domain_id
WHERE fa.verified_at IS NOT NULL AND (
	fr.mailbox_id = m.id
	OR (NOT m.forward_off AND fr.domain_id = m.domain_id)
	OR (NOT m.forward_off AND NOT coalesce(d.forward_off, false) AND fr.domain_id IS NULL AND fr.mailbox_id IS NULL))
ORDER BY fa.address`, mailboxID)
}

// ForUnknown returns where mail for an address with no mailbox goes: the
// rules of its domain, then the instance's. Empty when the domain is not ours.
func ForUnknown(ctx context.Context, q db.Querier, address string) ([]string, error) {
	return collect(ctx, q, `
SELECT DISTINCT fa.address FROM forward_rule fr
JOIN forward_address fa ON fa.id = fr.address_id
JOIN domain d ON d.name = $1
WHERE fa.verified_at IS NOT NULL AND (
	fr.domain_id = d.id
	OR (NOT d.forward_off AND fr.domain_id IS NULL AND fr.mailbox_id IS NULL))
ORDER BY fa.address`, addr.DomainOf(address))
}

func collect(ctx context.Context, q db.Querier, sql string, arg string) ([]string, error) {
	rows, _ := q.Query(ctx, sql, arg)
	out, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("forward targets: %w", err)
	}
	return out, nil
}
