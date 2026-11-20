// Package idempotency makes a POST with an Idempotency-Key run once: a
// repeat with the same body gets the first reply back, a repeat with a
// different body is a 409. Keys live 24 hours, per caller and endpoint.
package idempotency

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/httpx"
)

// staleClaim is how long an unfinished claim blocks its key. A request
// that died mid-way frees the key after this.
const staleClaim = 2 * time.Minute

// Store keeps replies.
type Store struct{ DB *pgxpool.Pool }

// Reply is a stored response.
type Reply struct {
	Status   int
	Body     json.RawMessage
	Replayed bool
}

// Do runs fn unless (scope, key) already ran. The key is claimed with a
// row (status 0) before fn runs, so a concurrent repeat sees the claim and
// gets a 409 instead of running fn again; no connection is held while fn
// runs. Only a successful reply is kept: a failed call frees its key.
func (s *Store) Do(ctx context.Context, scope, key, endpoint string, body []byte, fn func() (int, any, error)) (*Reply, error) {
	if len(key) > 255 {
		return nil, httpx.Invalid("Idempotency-Key", "Idempotency-Key: At most 255 characters")
	}
	sum := sha256.Sum256(body)
	hash := hex.EncodeToString(sum[:])
	full := scope + ":" + endpoint + ":" + key

	// Claim the key, or take over one that is expired or abandoned.
	tag, err := s.DB.Exec(ctx, `INSERT INTO idempotency_record (key, request_hash, endpoint, status_code, response)
		VALUES ($1, $2, $3, 0, 'null') ON CONFLICT (key) DO UPDATE SET request_hash = excluded.request_hash,
			status_code = 0, response = 'null', created_at = now()
		WHERE idempotency_record.created_at < now() - interval '24 hours'
			OR (idempotency_record.status_code = 0 AND idempotency_record.created_at < now() - $4::interval)`,
		full, hash, endpoint, staleClaim.String())
	if err != nil {
		return nil, fmt.Errorf("idempotency claim: %w", err)
	}
	if tag.RowsAffected() == 0 {
		var prevHash string
		r := &Reply{Replayed: true}
		err := s.DB.QueryRow(ctx, `SELECT request_hash, status_code, response FROM idempotency_record WHERE key = $1`, full).
			Scan(&prevHash, &r.Status, &r.Body)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return nil, httpx.Conflict("A request with this idempotency key just finished; retry")
		case err != nil:
			return nil, fmt.Errorf("idempotency lookup: %w", err)
		case prevHash != hash:
			return nil, httpx.Conflict("This idempotency key was used with a different request")
		case r.Status == 0:
			return nil, httpx.Conflict("A request with this idempotency key is still in progress")
		}
		return r, nil
	}

	// From here the work is ours; finishing must not depend on the caller
	// staying connected, or a retry would run it twice.
	done, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	status, v, err := fn()
	if err != nil {
		_, _ = s.DB.Exec(done, `DELETE FROM idempotency_record WHERE key = $1 AND status_code = 0`, full)
		return nil, err
	}
	out, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	if _, err := s.DB.Exec(done, `UPDATE idempotency_record SET status_code = $2, response = $3 WHERE key = $1`, full, status, out); err != nil {
		return nil, fmt.Errorf("idempotency store: %w", err)
	}
	return &Reply{Status: status, Body: out}, nil
}

// Sweep deletes records older than a day.
func (s *Store) Sweep(ctx context.Context) error {
	_, err := s.DB.Exec(ctx, `DELETE FROM idempotency_record WHERE created_at < now() - interval '24 hours'`)
	return err
}
