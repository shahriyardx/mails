package mail

import (
	"context"
	"fmt"

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
