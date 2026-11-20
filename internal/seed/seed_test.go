package seed_test

import (
	"context"
	"testing"
	"time"

	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/seed"
)

// Label names are unique without regard to case: the demo reuses an
// existing "projects" (and an exact "Receipts") instead of failing.
func TestDemoReusesLabelsOfAnyCase(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO label (id, name) VALUES ('lbl_p', 'projects'), ('lbl_r', 'Receipts')`); err != nil {
		t.Fatal(err)
	}
	if _, err := seed.Demo(ctx, pool, "", time.Now()); err != nil {
		t.Fatalf("demo: %v", err)
	}
	var labels, onProjects int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM label`).Scan(&labels)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM thread_label WHERE label_id = 'lbl_p'`).Scan(&onProjects)
	if labels != 2 || onProjects == 0 {
		t.Fatalf("labels=%d threads on projects=%d", labels, onProjects)
	}
}

func TestDemoAndRemove(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	n, err := seed.Demo(ctx, pool, "", time.Now())
	if err != nil || n != 20 {
		t.Fatalf("demo: %d %v", n, err)
	}
	var threads, spam, starred int
	_ = pool.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE folders = '{spam}'), count(*) FILTER (WHERE is_starred) FROM thread`).
		Scan(&threads, &spam, &starred)
	if threads != 17 || spam != 1 || starred != 3 {
		t.Fatalf("threads=%d spam=%d starred=%d", threads, spam, starred)
	}
	// Running again changes nothing: Message-IDs dedupe.
	if _, err := seed.Demo(ctx, pool, "", time.Now()); err != nil {
		t.Fatal(err)
	}
	removed, err := seed.Remove(ctx, pool)
	if err != nil || removed < 20 {
		t.Fatalf("remove: %d %v", removed, err)
	}
	var left int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM message`).Scan(&left)
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM thread`).Scan(&threads)
	if left != 0 || threads != 0 {
		t.Fatalf("left messages=%d threads=%d", left, threads)
	}
}
