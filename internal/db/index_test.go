package db_test

import (
	"context"
	"strings"
	"testing"

	"github.com/shahriyardx/mails/internal/db/dbtest"
)

// Each list pages through an index in its own order: no sort over the
// whole table. The queries have the shape the list code builds (ORDER BY
// and cursor on the same key).
func TestListsUseIndexes(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SET enable_seqscan = off; SET enable_bitmapscan = off; SET enable_sort = off`); err != nil {
		t.Fatal(err)
	}
	tests := []struct{ name, sql, index string }{
		{"messages", `SELECT id FROM message m WHERE (m.received_at, m.id) < (now(), 'x')
			ORDER BY m.received_at DESC, m.id DESC LIMIT 51`, "message_received_idx"},
		{"api emails", `SELECT id FROM message m WHERE m.is_outbound = true AND m.is_draft = false
			ORDER BY m.received_at DESC, m.id DESC LIMIT 51`, "message_outbound_received_idx"},
		{"delivery log", `SELECT id FROM message m WHERE m.is_outbound = true AND NOT m.is_draft
			AND (coalesce(m.sent_at, m.created_at), m.id) < (now(), 'x')
			ORDER BY coalesce(m.sent_at, m.created_at) DESC, m.id DESC LIMIT 51`, "message_sent_idx"},
		{"contacts recent", `SELECT id FROM contact WHERE (last_seen_at, id) < (now(), 'x')
			ORDER BY last_seen_at DESC, id DESC LIMIT 51`, "contact_recent_idx"},
		{"contacts frequent", `SELECT id FROM contact WHERE (message_count, id) < (3, 'x')
			ORDER BY message_count DESC, id DESC LIMIT 51`, "contact_frequent_idx"},
	}
	for _, tt := range tests {
		rows, _ := conn.Query(ctx, `EXPLAIN `+tt.sql)
		var plan []string
		for rows.Next() {
			var line string
			if err := rows.Scan(&line); err != nil {
				t.Fatal(err)
			}
			plan = append(plan, line)
		}
		if err := rows.Err(); err != nil {
			t.Fatalf("%s: %v", tt.name, err)
		}
		got := strings.Join(plan, "\n")
		if !strings.Contains(got, tt.index) || strings.Contains(got, "Sort") {
			t.Errorf("%s: want an ordered scan of %s, got\n%s", tt.name, tt.index, got)
		}
	}
}
