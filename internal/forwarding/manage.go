package forwarding

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"net/http"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/cloudflare"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/id"
)

// Manager keeps the destination addresses (mirrored from Cloudflare Email
// Routing, which must verify each one) and the rules that use them.
type Manager struct {
	DB *pgxpool.Pool
	CF *cloudflare.Service
}

// Address is a destination mail can be forwarded to.
type Address struct {
	ID           string    `json:"id"`
	Address      string    `json:"address"`
	Verified     bool      `json:"verified"`
	InCloudflare bool      `json:"in_cloudflare"`
	Uses         int       `json:"uses"`
	CreatedAt    time.Time `json:"created_at"`
}

// Rule is one use of an address at one width.
type Rule struct {
	ID        string `json:"id"`
	AddressID string `json:"address_id"`
}

// Scoped is a domain or mailbox with its rules.
type Scoped struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	ForwardOff bool   `json:"forward_off"`
	Rules      []Rule `json:"rules"`
}

// View is the forwarding settings page.
type View struct {
	Connected bool      `json:"connected"`
	Addresses []Address `json:"addresses"`
	Instance  []Rule    `json:"instance"`
	Domains   []Scoped  `json:"domains"`
	Mailboxes []Scoped  `json:"mailboxes"`
}

func (m *Manager) View(ctx context.Context) (*View, error) {
	v := &View{Addresses: []Address{}, Instance: []Rule{}, Domains: []Scoped{}, Mailboxes: []Scoped{}}
	_, _, err := m.CF.Client(ctx)
	v.Connected = err == nil

	rows, _ := m.DB.Query(ctx, `SELECT a.id, a.address, a.verified_at IS NOT NULL, a.destination_id IS NOT NULL,
		(SELECT count(*) FROM forward_rule r WHERE r.address_id = a.id), a.created_at FROM forward_address a ORDER BY a.address`)
	if v.Addresses, err = pgx.CollectRows(rows, pgx.RowToStructByPos[Address]); err != nil {
		return nil, fmt.Errorf("forward addresses: %w", err)
	}
	type ruleRow struct {
		ID, AddressID     string
		DomainID, Mailbox *string
	}
	rows, _ = m.DB.Query(ctx, `SELECT id, address_id, domain_id, mailbox_id FROM forward_rule ORDER BY created_at`)
	rules, err := pgx.CollectRows(rows, pgx.RowToStructByPos[ruleRow])
	if err != nil {
		return nil, fmt.Errorf("forward rules: %w", err)
	}
	byDomain, byMailbox := map[string][]Rule{}, map[string][]Rule{}
	for _, r := range rules {
		rule := Rule{r.ID, r.AddressID}
		switch {
		case r.DomainID != nil:
			byDomain[*r.DomainID] = append(byDomain[*r.DomainID], rule)
		case r.Mailbox != nil:
			byMailbox[*r.Mailbox] = append(byMailbox[*r.Mailbox], rule)
		default:
			v.Instance = append(v.Instance, rule)
		}
	}
	scoped := func(sql string, by map[string][]Rule) ([]Scoped, error) {
		rows, _ := m.DB.Query(ctx, sql)
		list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Scoped, error) {
			var s Scoped
			err := r.Scan(&s.ID, &s.Name, &s.ForwardOff)
			s.Rules = by[s.ID]
			if s.Rules == nil {
				s.Rules = []Rule{}
			}
			return s, err
		})
		return list, err
	}
	if v.Domains, err = scoped(`SELECT id, name, forward_off FROM domain ORDER BY name`, byDomain); err != nil {
		return nil, fmt.Errorf("forward domains: %w", err)
	}
	if v.Mailboxes, err = scoped(`SELECT id, address, forward_off FROM mailbox ORDER BY address`, byMailbox); err != nil {
		return nil, fmt.Errorf("forward mailboxes: %w", err)
	}
	return v, nil
}

const destinationsPermission = "the account permission Email Routing Addresses -> Edit (the account one, not the zone permission of a similar name)"

// ownDomain reports whether address is on a domain this instance receives
// on: forwarding there would loop the mail straight back in.
func (m *Manager) ownDomain(ctx context.Context, address string) (bool, error) {
	rows, _ := m.DB.Query(ctx, `SELECT name FROM domain`)
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return false, fmt.Errorf("load domains: %w", err)
	}
	return addr.Covering(address, names) >= 0, nil
}

// AddAddress registers a destination with Cloudflare (which emails it a
// verification link) and lists it here.
func (m *Manager) AddAddress(ctx context.Context, address string) (*Address, error) {
	address = strings.ToLower(strings.TrimSpace(address))
	if !addr.Valid(address) {
		return nil, httpx.Invalid("address", "address: Not an email address")
	}
	if own, err := m.ownDomain(ctx, address); err != nil {
		return nil, err
	} else if own {
		return nil, httpx.Invalid("address", addr.DomainOf(address)+" receives mail here. Forwarding there would send the mail straight back in.")
	}
	api, account, err := m.CF.Client(ctx)
	if err != nil {
		return nil, err
	}
	// Cloudflare may know it already (added by hand, or left over).
	known, err := api.Destinations(ctx, account)
	if err != nil {
		return nil, cloudflareErr(err)
	}
	var dest *cloudflare.Destination
	for i, d := range known {
		if d.Email == address {
			dest = &known[i]
		}
	}
	if dest == nil {
		if dest, err = api.AddDestination(ctx, account, address); err != nil {
			return nil, cloudflareErr(err)
		}
	}
	a := &Address{ID: id.New("fwa"), Address: address, Verified: dest.Verified != nil, InCloudflare: true}
	err = m.DB.QueryRow(ctx, `INSERT INTO forward_address (id, address, destination_id, verified_at, checked_at)
		VALUES ($1, $2, $3, $4, now()) ON CONFLICT (address) DO NOTHING RETURNING created_at`,
		a.ID, address, dest.ID, dest.Verified).Scan(&a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.Conflict("That address is already on the list")
	}
	if err != nil {
		return nil, fmt.Errorf("insert forward address: %w", err)
	}
	return a, nil
}

func cloudflareErr(err error) error {
	if cloudflare.Unauthorized(err) {
		return httpx.Invalid("", "Cloudflare rejected the token. It needs "+destinationsPermission+".")
	}
	return httpx.Upstream(err.Error())
}

// Refresh pulls verification state from Cloudflare and adopts destinations
// added there by hand (listing one forwards nothing without a rule).
func (m *Manager) Refresh(ctx context.Context) error {
	api, account, err := m.CF.Client(ctx)
	if err != nil {
		return err
	}
	known, err := api.Destinations(ctx, account)
	if err != nil {
		return cloudflareErr(err)
	}
	return pgx.BeginFunc(ctx, m.DB, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE forward_address SET destination_id = NULL, verified_at = NULL, checked_at = now()`); err != nil {
			return err
		}
		for _, d := range known {
			if own, err := m.ownDomain(ctx, d.Email); err != nil || own {
				continue
			}
			if _, err := tx.Exec(ctx, `INSERT INTO forward_address (id, address, destination_id, verified_at, checked_at)
				VALUES ($1, $2, $3, $4, now()) ON CONFLICT (address) DO UPDATE SET destination_id = excluded.destination_id,
				verified_at = excluded.verified_at, checked_at = now()`, id.New("fwa"), d.Email, d.ID, d.Verified); err != nil {
				return fmt.Errorf("sync destination: %w", err)
			}
		}
		return nil
	})
}

// RemoveAddress drops an address and its rules, and optionally the
// Cloudflare destination.
func (m *Manager) RemoveAddress(ctx context.Context, addressID string, inCloudflare bool) error {
	var dest *string
	err := m.DB.QueryRow(ctx, `DELETE FROM forward_address WHERE id = $1 RETURNING destination_id`, addressID).Scan(&dest)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpx.NotFound("No such forwarding address")
	}
	if err != nil {
		return fmt.Errorf("delete forward address: %w", err)
	}
	if inCloudflare && dest != nil {
		api, account, err := m.CF.Client(ctx)
		if err != nil {
			return err
		}
		if err := api.DeleteDestination(ctx, account, *dest); err != nil {
			slog.Warn("delete cloudflare destination", "err", err)
			return cloudflareErr(err)
		}
	}
	return nil
}

// AddRule forwards mail at one width: a domain, a mailbox, or (both empty)
// the whole instance.
func (m *Manager) AddRule(ctx context.Context, addressID, domainID, mailboxID string) (*Rule, error) {
	if domainID != "" && mailboxID != "" {
		return nil, httpx.Invalid("domain_id", "Give a domain or a mailbox, not both")
	}
	var exists bool
	err := m.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM forward_rule WHERE address_id = $1
		AND domain_id IS NOT DISTINCT FROM nullif($2, '') AND mailbox_id IS NOT DISTINCT FROM nullif($3, ''))`,
		addressID, domainID, mailboxID).Scan(&exists)
	if err != nil {
		return nil, fmt.Errorf("check rule: %w", err)
	}
	if exists {
		return nil, httpx.Conflict("That rule already exists")
	}
	r := &Rule{ID: id.New("fwr"), AddressID: addressID}
	_, err = m.DB.Exec(ctx, `INSERT INTO forward_rule (id, address_id, domain_id, mailbox_id) VALUES ($1, $2, nullif($3, ''), nullif($4, ''))`,
		r.ID, addressID, domainID, mailboxID)
	if err != nil {
		return nil, httpx.Invalid("address_id", "Unknown address, domain or mailbox")
	}
	return r, nil
}

func (m *Manager) RemoveRule(ctx context.Context, ruleID string) error {
	tag, err := m.DB.Exec(ctx, `DELETE FROM forward_rule WHERE id = $1`, ruleID)
	if err != nil {
		return fmt.Errorf("delete rule: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("No such rule")
	}
	return nil
}

// Routes is the dashboard API, mounted at /api/app/forwarding.
func Routes(m *Manager) http.Handler {
	r := chi.NewRouter()
	r.Method("GET", "/", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		v, err := m.View(r.Context())
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, v)
		return nil
	}))
	r.Method("POST", "/addresses", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			Address string `json:"address" validate:"required"`
		}
		if err := httpx.Bind(r, &in); err != nil {
			return err
		}
		a, err := m.AddAddress(r.Context(), in.Address)
		if err != nil {
			return err
		}
		httpx.JSON(w, 201, a)
		return nil
	}))
	r.Method("POST", "/refresh", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		if err := m.Refresh(r.Context()); err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}))
	r.Method("DELETE", "/addresses/{id}", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		if err := m.RemoveAddress(r.Context(), chi.URLParam(r, "id"), r.URL.Query().Get("cloudflare") == "true"); err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}))
	r.Method("POST", "/rules", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			AddressID string `json:"address_id" validate:"required"`
			DomainID  string `json:"domain_id"`
			MailboxID string `json:"mailbox_id"`
		}
		if err := httpx.Bind(r, &in); err != nil {
			return err
		}
		rule, err := m.AddRule(r.Context(), in.AddressID, in.DomainID, in.MailboxID)
		if err != nil {
			return err
		}
		httpx.JSON(w, 201, rule)
		return nil
	}))
	r.Method("DELETE", "/rules/{id}", httpx.Handler(func(w http.ResponseWriter, r *http.Request) error {
		if err := m.RemoveRule(r.Context(), chi.URLParam(r, "id")); err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}))
	return r
}
