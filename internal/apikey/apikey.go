// Package apikey makes, stores and checks API keys. A key is shown once and
// stored only as a SHA-256 hash; each carries scopes (what kind of call)
// and reach (which mailboxes).
package apikey

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/db"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/id"
)

const (
	tokenPrefix      = "mk_live_"
	DefaultRateLimit = 300
)

// Hash is how a token is stored and looked up.
func Hash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// newToken returns a token and the short form shown in lists.
func newToken() (token, prefix string) {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	secret := base64.RawURLEncoding.EncodeToString(b)
	return tokenPrefix + secret, tokenPrefix + secret[:4] + "…" + secret[len(secret)-4:]
}

// Reach is which mailboxes a key may touch. Unrestricted when both lists
// are empty.
type Reach struct {
	DomainIDs  []string `json:"domains"`
	MailboxIDs []string `json:"mailboxes"`
}

func (r Reach) Unrestricted() bool { return len(r.DomainIDs) == 0 && len(r.MailboxIDs) == 0 }

// Key is a stored key, never with its token.
type Key struct {
	Object     string     `json:"object"`
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	Scopes     []string   `json:"scopes"`
	Reach      Reach      `json:"reach"`
	RateLimit  int        `json:"rate_limit_per_minute"`
	LastUsedAt *time.Time `json:"last_used_at"`
	RevokedAt  *time.Time `json:"revoked_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

const columns = `id, name, prefix, scopes, scope_domain_ids, scope_mailbox_ids, coalesce(rate_limit, 300), last_used_at, revoked_at, created_at`

func scanKey(row pgx.CollectableRow) (*Key, error) {
	k := &Key{Object: "api_key"}
	err := row.Scan(&k.ID, &k.Name, &k.Prefix, &k.Scopes, &k.Reach.DomainIDs, &k.Reach.MailboxIDs, &k.RateLimit, &k.LastUsedAt, &k.RevokedAt, &k.CreatedAt)
	return k, err
}

// Service manages keys.
type Service struct {
	DB *pgxpool.Pool
}

// Authenticate returns the live key for a bearer token, or nil.
func (s *Service) Authenticate(ctx context.Context, token string) (*Key, error) {
	if !strings.HasPrefix(token, tokenPrefix) {
		return nil, nil
	}
	rows, _ := s.DB.Query(ctx, `UPDATE api_key SET last_used_at = now() WHERE hash = $1 AND revoked_at IS NULL RETURNING `+columns, Hash(token))
	k, err := pgx.CollectExactlyOneRow(rows, scanKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("authenticate: %w", err)
	}
	return k, nil
}

func (s *Service) List(ctx context.Context) ([]*Key, error) {
	rows, _ := s.DB.Query(ctx, `SELECT `+columns+` FROM api_key ORDER BY revoked_at IS NOT NULL, created_at DESC`)
	return pgx.CollectRows(rows, scanKey)
}

// Input makes a key.
type Input struct {
	Name      string   `json:"name" validate:"required,max=100"`
	Scopes    []string `json:"scopes" validate:"required,min=1"`
	Reach     Reach    `json:"reach"`
	RateLimit *int     `json:"rate_limit_per_minute" validate:"omitempty,min=1,max=100000"`
}

// Create makes a key and returns it with its token, the only time the
// token is ever available.
func (s *Service) Create(ctx context.Context, in Input) (*Key, string, error) {
	if err := httpx.Validate(in); err != nil {
		return nil, "", err
	}
	for _, sc := range in.Scopes {
		if !Valid(sc) {
			return nil, "", httpx.Invalid("scopes", fmt.Sprintf("scopes: %q is not a scope", sc))
		}
	}
	if len(in.Reach.DomainIDs) > 0 && len(in.Reach.MailboxIDs) > 0 {
		return nil, "", httpx.Invalid("reach", "reach: Whole domains or named addresses, not both")
	}
	if err := s.checkReach(ctx, in.Reach); err != nil {
		return nil, "", err
	}
	token, prefix := newToken()
	newID := id.New("key")
	_, err := s.DB.Exec(ctx, `INSERT INTO api_key (id, name, prefix, hash, scopes, scope_domain_ids, scope_mailbox_ids, rate_limit)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, newID, strings.TrimSpace(in.Name), prefix, Hash(token),
		slices.Compact(in.Scopes), nonNil(in.Reach.DomainIDs), nonNil(in.Reach.MailboxIDs), in.RateLimit)
	if err != nil {
		return nil, "", fmt.Errorf("create key: %w", err)
	}
	k, err := s.Get(ctx, newID)
	return k, token, err
}

func (s *Service) checkReach(ctx context.Context, r Reach) error {
	var n int
	if len(r.DomainIDs) > 0 {
		if err := s.DB.QueryRow(ctx, `SELECT count(*) FROM domain WHERE id = ANY($1)`, r.DomainIDs).Scan(&n); err != nil {
			return err
		}
		if n != len(slices.Compact(slices.Sorted(slices.Values(r.DomainIDs)))) {
			return httpx.Invalid("reach", "reach.domains: Unknown domain")
		}
	}
	if len(r.MailboxIDs) > 0 {
		if err := s.DB.QueryRow(ctx, `SELECT count(*) FROM mailbox WHERE id = ANY($1)`, r.MailboxIDs).Scan(&n); err != nil {
			return err
		}
		if n != len(slices.Compact(slices.Sorted(slices.Values(r.MailboxIDs)))) {
			return httpx.Invalid("reach", "reach.mailboxes: Unknown mailbox")
		}
	}
	return nil
}

func (s *Service) Get(ctx context.Context, keyID string) (*Key, error) {
	rows, _ := s.DB.Query(ctx, `SELECT `+columns+` FROM api_key WHERE id = $1`, keyID)
	k, err := pgx.CollectExactlyOneRow(rows, scanKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.NotFound("No such API key")
	}
	return k, err
}

// Rename changes a key's name; scopes and reach are fixed at creation, so a
// key never quietly gains power.
func (s *Service) Rename(ctx context.Context, keyID, name string) (*Key, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 100 {
		return nil, httpx.Invalid("name", "name: Required, at most 100 characters")
	}
	tag, err := s.DB.Exec(ctx, `UPDATE api_key SET name = $2 WHERE id = $1`, keyID, name)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, httpx.NotFound("No such API key")
	}
	return s.Get(ctx, keyID)
}

// Revoke stops a key for good. Mail it sent keeps its api_key_id.
func (s *Service) Revoke(ctx context.Context, keyID string) error {
	tag, err := s.DB.Exec(ctx, `UPDATE api_key SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1`, keyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("No such API key")
	}
	return nil
}

// Allowed returns the mailbox ids a reach covers, or nil for every mailbox.
func Allowed(ctx context.Context, q db.Querier, r Reach) ([]string, error) {
	if r.Unrestricted() {
		return nil, nil
	}
	rows, _ := q.Query(ctx, `SELECT id FROM mailbox WHERE id = ANY($1) OR domain_id = ANY($2)`, nonNil(r.MailboxIDs), nonNil(r.DomainIDs))
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, fmt.Errorf("reach: %w", err)
	}
	if ids == nil {
		ids = []string{} // restricted to nothing is not "everything"
	}
	return ids, nil
}

// CoversDomainOf reports whether a key's reach covers address. The address
// belongs to the closest domain it sits on or under, among every domain of
// the instance (the one its mailbox will be filed under), and that domain
// must be one the key holds: holding a.test does not reach a separately
// added sub.a.test.
func CoversDomainOf(ctx context.Context, q db.Querier, r Reach, address string) (bool, error) {
	if r.Unrestricted() {
		return true, nil
	}
	if len(r.DomainIDs) == 0 {
		return false, nil
	}
	type dom struct{ ID, Name string }
	rows, _ := q.Query(ctx, `SELECT id, name FROM domain`)
	all, err := pgx.CollectRows(rows, pgx.RowToStructByPos[dom])
	if err != nil {
		return false, err
	}
	names := make([]string, len(all))
	for i, d := range all {
		names[i] = d.Name
	}
	i := addr.Covering(address, names)
	return i >= 0 && slices.Contains(r.DomainIDs, all[i].ID), nil
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
