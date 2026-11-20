package setup_test

import (
	"context"
	"testing"

	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/setup"
)

func TestWizard(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	s := &setup.Service{DB: pool, SESConfigured: true, Region: "us-east-1"}

	st, err := s.State(ctx)
	if err != nil || st.Completed || st.Remaining != 3 || st.BrandName != nil {
		t.Fatalf("fresh = %+v %v", st, err)
	}
	_, _ = pool.Exec(ctx, `INSERT INTO domain (id, name, region, status, sending_enabled) VALUES ('d', 'a.test', 'x', 'verified', true);
		INSERT INTO mailbox (id, address, domain, display_name) VALUES ('m', 'a@a.test', 'a.test', 'A')`)
	brand := "  Acme  "
	if st, err = s.Update(ctx, &brand, false); err != nil || *st.BrandName != "Acme" || st.Remaining != 1 || st.Completed {
		t.Fatalf("after steps = %+v %v", st, err)
	}
	if st, _ = s.Update(ctx, nil, true); !st.Completed || *st.BrandName != "Acme" {
		t.Fatalf("finished = %+v", st)
	}
	first := *st.CompletedAt
	if st, _ = s.Update(ctx, nil, true); !st.CompletedAt.Equal(first) {
		t.Fatal("finishing twice moved the date")
	}
	empty := ""
	if st, _ = s.Update(ctx, &empty, false); st.BrandName != nil {
		t.Fatal("empty brand not cleared")
	}
}
