// Package dbtest gives each test its own migrated scratch database.
//
// Needs a Postgres reachable at TEST_DATABASE_URL (default: the compose one
// on port 5437). Tests skip, not fail, when it is not running.
package dbtest

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/db"
)

func adminURL() string {
	if u := os.Getenv("TEST_DATABASE_URL"); u != "" {
		return u
	}
	return "postgres://mails:mails@localhost:5437/postgres?sslmode=disable"
}

// New creates a fresh database, migrates it, and drops it when t ends.
func New(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, adminURL())
	if err != nil {
		t.Skipf("no test Postgres (%v); run: docker compose up -d postgres", err)
	}
	name := fmt.Sprintf("mails_test_%s_%d", strings.ToLower(sanitize(t.Name())), time.Now().UnixNano())
	if _, err := admin.Exec(ctx, `CREATE DATABASE "`+name+`"`); err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(adminURL())
	u.Path = "/" + name
	pool, err := db.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Migrate(ctx, pool); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(ctx, `DROP DATABASE IF EXISTS "`+name+`" WITH (FORCE)`)
		_ = admin.Close(ctx)
	})
	return pool
}

func sanitize(s string) string {
	var b strings.Builder
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
		if b.Len() >= 30 {
			break
		}
	}
	return b.String()
}
