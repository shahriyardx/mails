package seed_test

import (
	"context"
	"testing"
	"time"

	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/seed"
)

func TestDemoAndRemove(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	n, err := seed.Demo(ctx, pool, "", time.Now())
	if err != nil || n != 9 {
		t.Fatalf("demo: %d %v", n, err)
	}
	var threads, spam, starred int
	_ = pool.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE folders = '{spam}'), count(*) FILTER (WHERE is_starred) FROM thread`).
		Scan(&threads, &spam, &starred)
	if threads != 7 || spam != 1 || starred != 2 {
		t.Fatalf("threads=%d spam=%d starred=%d", threads, spam, starred)
	}
	// Running again changes nothing: Message-IDs dedupe.
	if _, err := seed.Demo(ctx, pool, "", time.Now()); err != nil {
		t.Fatal(err)
	}
	removed, err := seed.Remove(ctx, pool)
	if err != nil || removed < 9 {
		t.Fatalf("remove: %d %v", removed, err)
	}
	var left int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM message`).Scan(&left)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM thread`).Scan(&threads)
	if left != 0 || threads != 0 {
		t.Fatalf("left messages=%d threads=%d", left, threads)
	}
}
