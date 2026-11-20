package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/db"
)

// command runs a maintenance subcommand. It reports whether args named one.
func command(args []string) (bool, error) {
	if len(args) == 0 {
		return false, nil
	}
	switch args[0] {
	case "serve":
		return false, nil
	case "reset-owner":
		return true, resetOwner()
	case "vapid-keys":
		priv, pub, err := webpush.GenerateVAPIDKeys()
		if err != nil {
			return true, err
		}
		fmt.Printf("VAPID_PUBLIC_KEY=%q\nVAPID_PRIVATE_KEY=%q\n", pub, priv)
		return true, nil
	case "migrate":
		return true, migrate()
	case "help", "-h", "--help":
		fmt.Println(`mails            run the server
mails migrate    apply database migrations and exit
mails reset-owner  remove the owner and every session; the next GitHub sign-in claims the instance (mail and settings stay)
mails vapid-keys print a new VAPID key pair for web push`)
		return true, nil
	default:
		return true, fmt.Errorf("unknown command %q (try: mails help)", args[0])
	}
}

func openDB(ctx context.Context) (*pgxpool.Pool, error) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return nil, errors.New("DATABASE_URL is not set")
	}
	return db.Open(ctx, url)
}

func resetOwner() error {
	ctx := context.Background()
	pool, err := openDB(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM sessions`); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM app_user`)
		return err
	})
	if err != nil {
		return err
	}
	fmt.Println("Owner removed and every session ended. The next GitHub sign-in claims this instance.")
	return nil
}

func migrate() error {
	ctx := context.Background()
	pool, err := openDB(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}
	fmt.Println("Migrations up to date.")
	return nil
}
