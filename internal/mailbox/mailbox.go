// Package mailbox manages the addresses mail is sent from and delivered to.
package mailbox

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/db"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/id"
)

// Mailbox is one row, shaped as the public API returns it.
type Mailbox struct {
	Object      string    `json:"object" db:"-"`
	ID          string    `json:"id" db:"id"`
	Address     string    `json:"address" db:"address"`
	Domain      string    `json:"domain" db:"domain"`
	DomainID    *string   `json:"domain_id" db:"domain_id"`
	DisplayName string    `json:"display_name" db:"display_name"`
	Signature   *string   `json:"signature" db:"signature"`
	IsCatchAll  bool      `json:"is_catch_all" db:"is_catch_all"`
	IsDefault   bool      `json:"is_default" db:"is_default"`
	Color       string    `json:"color" db:"color"`
	ForwardOff  bool      `json:"forward_off" db:"forward_off"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

// From is the formatted From header: "Display Name <address>".
func (m *Mailbox) From() addr.Address { return addr.Address{Name: m.DisplayName, Address: m.Address} }

const columns = `id, address, domain, domain_id, display_name, signature, is_catch_all, is_default, color, forward_off, created_at`

// Service holds what mailbox operations need.
type Service struct {
	DB *pgxpool.Pool
}

func query(ctx context.Context, q db.Querier, where string, args ...any) ([]*Mailbox, error) {
	rows, _ := q.Query(ctx, `SELECT `+columns+` FROM mailbox `+where, args...)
	list, err := pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[Mailbox])
	if err != nil {
		return nil, fmt.Errorf("query mailboxes: %w", err)
	}
	for _, m := range list {
		m.Object = "mailbox"
	}
	return list, nil
}

// List returns every mailbox, by domain then address. A non-empty domain
// narrows to that domain.
func (s *Service) List(ctx context.Context, domain string) ([]*Mailbox, error) {
	if domain != "" {
		return query(ctx, s.DB, `WHERE domain = lower($1) ORDER BY address`, domain)
	}
	return query(ctx, s.DB, `ORDER BY domain, address`)
}

// Get finds a mailbox by id or by address.
func (s *Service) Get(ctx context.Context, idOrAddress string) (*Mailbox, error) {
	list, err := query(ctx, s.DB, `WHERE id = $1 OR address = lower($1)`, idOrAddress)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, httpx.NotFound("No such mailbox")
	}
	return list[0], nil
}

// Default is the mailbox the composer starts on: the marked one, else the
// first. Nil when there are none.
func (s *Service) Default(ctx context.Context) (*Mailbox, error) {
	list, err := query(ctx, s.DB, `ORDER BY is_default DESC, created_at LIMIT 1`)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return list[0], nil
}

// Input creates a mailbox.
type Input struct {
	Address     string  `json:"address" validate:"required,email,max=254"`
	DisplayName string  `json:"display_name" validate:"max=200"`
	Signature   *string `json:"signature" validate:"omitempty,max=20000"`
	IsCatchAll  bool    `json:"is_catch_all"`
	IsDefault   bool    `json:"is_default"`
	Color       string  `json:"color" validate:"max=64"`
}

type coveringDomain struct {
	ID       string
	Name     string
	Sendable bool
}

// covering returns the domain an address sits on or under, or nil.
func (s *Service) covering(ctx context.Context, address string) (*coveringDomain, error) {
	rows, _ := s.DB.Query(ctx, `SELECT id, name, status = 'verified' AND sending_enabled FROM domain`)
	all, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (coveringDomain, error) {
		var d coveringDomain
		return d, r.Scan(&d.ID, &d.Name, &d.Sendable)
	})
	if err != nil {
		return nil, fmt.Errorf("query domains: %w", err)
	}
	names := make([]string, len(all))
	for i, d := range all {
		names[i] = d.Name
	}
	if i := addr.Covering(address, names); i >= 0 {
		return &all[i], nil
	}
	return nil, nil
}

// Create adds a mailbox on a domain this instance has, or under one. The
// first mailbox becomes the default.
func (s *Service) Create(ctx context.Context, in Input) (*Mailbox, error) {
	if err := httpx.Validate(in); err != nil {
		return nil, err
	}
	address := strings.ToLower(strings.TrimSpace(in.Address))
	dom, err := s.covering(ctx, address)
	if err != nil {
		return nil, err
	}
	if dom == nil {
		return nil, httpx.Invalid("address", fmt.Sprintf("Add %s under Domains first, or a domain it sits beneath", addr.DomainOf(address)))
	}
	name := strings.TrimSpace(in.DisplayName)
	if name == "" {
		name = addr.LocalOf(address)
	}
	color := in.Color
	if color == "" {
		color = addr.Color(address)
	}
	newID := id.New("mbx")
	err = pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `INSERT INTO mailbox (id, address, domain, domain_id, display_name, signature, is_catch_all, is_default, color)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8 OR NOT EXISTS (SELECT 1 FROM mailbox), $9) ON CONFLICT (address) DO NOTHING`,
			newID, address, addr.DomainOf(address), dom.ID, name, in.Signature, in.IsCatchAll, in.IsDefault, color)
		if err != nil {
			return fmt.Errorf("insert mailbox: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return httpx.Conflict("That mailbox already exists")
		}
		if in.IsDefault {
			return clearOtherDefaults(ctx, tx, newID)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, newID)
}

func clearOtherDefaults(ctx context.Context, tx pgx.Tx, keep string) error {
	_, err := tx.Exec(ctx, `UPDATE mailbox SET is_default = false WHERE is_default AND id <> $1`, keep)
	if err != nil {
		return fmt.Errorf("clear default: %w", err)
	}
	return nil
}

// Patch changes a mailbox. Unset fields stay. The address never changes:
// renaming would orphan the mail threaded under it.
type Patch struct {
	DisplayName httpx.Opt[string] `json:"display_name"`
	Signature   httpx.Opt[string] `json:"signature"`
	IsCatchAll  httpx.Opt[bool]   `json:"is_catch_all"`
	IsDefault   httpx.Opt[bool]   `json:"is_default"`
	Color       httpx.Opt[string] `json:"color"`
	ForwardOff  httpx.Opt[bool]   `json:"forward_off"`
}

func (s *Service) Update(ctx context.Context, idOrAddress string, p Patch) (*Mailbox, error) {
	m, err := s.Get(ctx, idOrAddress)
	if err != nil {
		return nil, err
	}
	if p.DisplayName.Set {
		if v := strings.TrimSpace(p.DisplayName.Value); v != "" && len(v) <= 200 {
			m.DisplayName = v
		} else {
			return nil, httpx.Invalid("display_name", "display_name: Required, at most 200 characters")
		}
	}
	if p.Signature.Set {
		m.Signature = p.Signature.Ptr()
	}
	if p.IsCatchAll.Set {
		m.IsCatchAll = p.IsCatchAll.Value
	}
	if p.IsDefault.Set {
		m.IsDefault = p.IsDefault.Value
	}
	if p.Color.Set && p.Color.Value != "" {
		m.Color = p.Color.Value
	}
	if p.ForwardOff.Set {
		m.ForwardOff = p.ForwardOff.Value
	}
	err = pgx.BeginFunc(ctx, s.DB, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE mailbox SET display_name = $2, signature = $3, is_catch_all = $4, is_default = $5,
			color = $6, forward_off = $7 WHERE id = $1`,
			m.ID, m.DisplayName, m.Signature, m.IsCatchAll, m.IsDefault, m.Color, m.ForwardOff)
		if err != nil {
			return fmt.Errorf("update mailbox: %w", err)
		}
		if m.IsDefault {
			return clearOtherDefaults(ctx, tx, m.ID)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return m, nil
}

// Delete removes a mailbox and all its mail. confirm must be true: a
// mistyped id should not empty an inbox.
func (s *Service) Delete(ctx context.Context, idOrAddress string, confirm bool) (*Mailbox, error) {
	m, err := s.Get(ctx, idOrAddress)
	if err != nil {
		return nil, err
	}
	if !confirm {
		return nil, httpx.Conflict("Deleting a mailbox deletes its mail. Repeat with confirm=true")
	}
	if _, err := s.DB.Exec(ctx, `DELETE FROM mailbox WHERE id = $1`, m.ID); err != nil {
		return nil, fmt.Errorf("delete mailbox: %w", err)
	}
	return m, nil
}

// ErrNotCovered means the address is on no sendable domain of this instance.
var ErrNotCovered = errors.New("address is not on a verified domain")

// ForSending returns the mailbox for a From address, creating it when the
// address sits on a verified domain. SES allows any address there, and code
// sends from noreply@ that nobody creates by hand.
func (s *Service) ForSending(ctx context.Context, address string) (*Mailbox, error) {
	address = strings.ToLower(strings.TrimSpace(address))
	if m, err := s.Get(ctx, address); err == nil {
		return m, nil
	} else if !isNotFound(err) {
		return nil, err
	}
	dom, err := s.covering(ctx, address)
	if err != nil {
		return nil, err
	}
	if dom == nil || !dom.Sendable {
		return nil, ErrNotCovered
	}
	return s.Ensure(ctx, address, dom.ID)
}

// Ensure creates a mailbox for address on domainID if none exists (two
// first sends can race) and returns it. Used by sending and by inbound
// auto-create.
func (s *Service) Ensure(ctx context.Context, address, domainID string) (*Mailbox, error) {
	address = strings.ToLower(address)
	_, err := s.DB.Exec(ctx, `INSERT INTO mailbox (id, address, domain, domain_id, display_name, color, is_default)
		VALUES ($1, $2, $3, $4, $5, $6, NOT EXISTS (SELECT 1 FROM mailbox)) ON CONFLICT (address) DO NOTHING`,
		id.New("mbx"), address, addr.DomainOf(address), domainID, addr.LocalOf(address), addr.Color(address))
	if err != nil {
		return nil, fmt.Errorf("ensure mailbox: %w", err)
	}
	return s.Get(ctx, address)
}

func isNotFound(err error) bool {
	var e *httpx.Error
	return errors.As(err, &e) && e.Status == 404
}
