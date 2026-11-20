package mail

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/db"
	"github.com/shahriyardx/mails/internal/id"
)

// TouchContact records that a message came from or went to a, for address
// completion. A name, once known, is kept.
func TouchContact(ctx context.Context, q db.Querier, a addr.Address) error {
	if a.Address == "" {
		return nil
	}
	var name *string
	if a.Name != "" {
		name = &a.Name
	}
	_, err := q.Exec(ctx, `INSERT INTO contact (id, address, name, message_count) VALUES ($1, lower($2), $3, 1)
		ON CONFLICT (address) DO UPDATE SET message_count = contact.message_count + 1, last_seen_at = now(),
			name = coalesce(contact.name, excluded.name)`, id.New("con"), a.Address, name)
	if err != nil {
		return fmt.Errorf("touch contact: %w", err)
	}
	return nil
}

// TouchContacts touches each address once, in address order: two
// transactions upserting [a, b] and [b, a] would otherwise deadlock.
func TouchContacts(ctx context.Context, q db.Querier, list []addr.Address) error {
	for _, a := range contactOrder(list) {
		if err := TouchContact(ctx, q, a); err != nil {
			return err
		}
	}
	return nil
}

// contactOrder lower-cases, sorts and de-duplicates list, keeping the
// first name given for an address. Blank addresses are dropped.
func contactOrder(list []addr.Address) []addr.Address {
	sorted := make([]addr.Address, 0, len(list))
	for _, a := range list {
		if a.Address != "" {
			a.Address = strings.ToLower(a.Address)
			sorted = append(sorted, a)
		}
	}
	slices.SortStableFunc(sorted, func(x, y addr.Address) int { return strings.Compare(x.Address, y.Address) })
	out := sorted[:0]
	for _, a := range sorted {
		switch last := len(out) - 1; {
		case last < 0 || out[last].Address != a.Address:
			out = append(out, a)
		case out[last].Name == "":
			out[last].Name = a.Name
		}
	}
	return out
}
