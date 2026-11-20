package auth_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/shahriyardx/mails/internal/auth"
	"github.com/shahriyardx/mails/internal/db/dbtest"
)

func TestFirstSignInClaimsInstance(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()

	id, err := auth.Claim(ctx, pool, auth.GitHubUser{ID: 1, Login: "owner", Email: "o@example.test"})
	if err != nil || id == "" {
		t.Fatalf("first claim: id=%q err=%v", id, err)
	}
	again, err := auth.Claim(ctx, pool, auth.GitHubUser{ID: 1, Login: "owner-renamed"})
	if err != nil || again != id {
		t.Fatalf("owner signing in again: id=%q err=%v, want %q", again, err, id)
	}
}

func TestSecondGitHubAccountRefused(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()

	if _, err := auth.Claim(ctx, pool, auth.GitHubUser{ID: 1, Login: "owner", Email: "same@example.test"}); err != nil {
		t.Fatal(err)
	}
	// Same email, different GitHub account: must not link to the owner.
	_, err := auth.Claim(ctx, pool, auth.GitHubUser{ID: 2, Login: "intruder", Email: "same@example.test"})
	if !errors.Is(err, auth.ErrTaken) {
		t.Fatalf("second account: err=%v, want ErrTaken", err)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM app_user`).Scan(&n)
	if n != 1 {
		t.Fatalf("users = %d, want 1", n)
	}
}

func TestRaceForFirstClaimHasOneWinner(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = auth.Claim(ctx, pool, auth.GitHubUser{ID: int64(i + 1), Login: "racer"})
		}()
	}
	wg.Wait()
	won := 0
	for _, err := range errs {
		if err == nil {
			won++
		} else if !errors.Is(err, auth.ErrTaken) {
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if won != 1 {
		t.Fatalf("winners = %d, want 1", won)
	}
}

func TestResetOwnerLetsNextAccountClaim(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()

	if _, err := auth.Claim(ctx, pool, auth.GitHubUser{ID: 1, Login: "old"}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM app_user`); err != nil {
		t.Fatal(err)
	}
	if _, err := auth.Claim(ctx, pool, auth.GitHubUser{ID: 2, Login: "new"}); err != nil {
		t.Fatalf("claim after reset: %v", err)
	}
}
