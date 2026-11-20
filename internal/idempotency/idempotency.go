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

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/httpx"
)

// Store keeps replies.
type Store struct{ DB *pgxpool.Pool }

// Reply is a stored response.
type Reply struct {
	Status   int
	Body     json.RawMessage
	Replayed bool
}

// Do runs fn unless (scope, key) already ran. Two calls with one key at the
// same moment are serialized with an advisory lock, so fn runs once. Only a
// successful reply is stored: a failed call can be retried with its key.
func (s *Store) Do(ctx context.Context, scope, key, endpoint string, body []byte, fn func() (int, any, error)) (*Reply, error) {
	if len(key) > 255 {
		return nil, httpx.Invalid("Idempotency-Key", "Idempotency-Key: At most 255 characters")
	}
	sum := sha256.Sum256(body)
	hash := hex.EncodeToString(sum[:])
	full := scope + ":" + endpoint + ":" + key

	conn, err := s.DB.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(hashtextextended($1, 0))`, full); err != nil {
		return nil, fmt.Errorf("idempotency lock: %w", err)
	}
	defer func() {
		_, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(hashtextextended($1, 0))`, full)
	}()

	var prevHash string
	r := &Reply{Replayed: true}
	err = conn.QueryRow(ctx, `SELECT request_hash, status_code, response FROM idempotency_record
		WHERE key = $1 AND created_at > now() - interval '24 hours'`, full).Scan(&prevHash, &r.Status, &r.Body)
	switch {
	case err == nil && prevHash != hash:
		return nil, httpx.Conflict("This idempotency key was used with a different request")
	case err == nil:
		return r, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return nil, fmt.Errorf("idempotency lookup: %w", err)
	}

	status, v, err := fn()
	if err != nil {
		return nil, err
	}
	out, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	if _, err := conn.Exec(ctx, `INSERT INTO idempotency_record (key, request_hash, endpoint, status_code, response)
		VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO UPDATE SET request_hash = excluded.request_hash,
		status_code = excluded.status_code, response = excluded.response, created_at = now()`,
		full, hash, endpoint, status, out); err != nil {
		return nil, fmt.Errorf("idempotency store: %w", err)
	}
	return &Reply{Status: status, Body: out}, nil
}

// Sweep deletes records older than a day.
func (s *Store) Sweep(ctx context.Context) error {
	_, err := s.DB.Exec(ctx, `DELETE FROM idempotency_record WHERE created_at < now() - interval '24 hours'`)
	return err
}
