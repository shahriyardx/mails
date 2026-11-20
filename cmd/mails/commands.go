package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/db"
	"github.com/shahriyardx/mails/internal/reporting"
	"github.com/shahriyardx/mails/internal/seed"
	"github.com/shahriyardx/mails/internal/ses"
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
	case "ses-setup-events":
		return true, sesSetupEvents()
	case "seed-demo":
		return true, seedDemo(args[1:])
	case "help", "-h", "--help":
		fmt.Println(`mails            run the server
mails migrate    apply database migrations and exit
mails reset-owner  remove the owner and every session; the next GitHub sign-in claims the instance (mail and settings stay)
mails vapid-keys print a new VAPID key pair for web push
mails ses-setup-events  set up SES delivery reporting (SNS topic, configuration set, subscription); same as Settings -> Reporting
mails seed-demo [--mailbox=ADDRESS] [--remove]  add (or remove) demo mail for trying the dashboard`)
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

func sesSetupEvents() error {
	ctx := context.Background()
	pool, err := openDB(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}
	awsCfg, err := ses.Config(ctx, envOr("AWS_REGION", "us-east-1"), os.Getenv("AWS_ACCESS_KEY_ID"), os.Getenv("AWS_SECRET_ACCESS_KEY"))
	if err != nil {
		return err
	}
	r := &reporting.Service{DB: pool, AWS: reporting.NewAWS(awsCfg), AppURL: strings.TrimRight(os.Getenv("APP_URL"), "/"),
		EnvConfigSet: os.Getenv("SES_CONFIGURATION_SET"), EnvTopicARN: os.Getenv("SES_SNS_TOPIC_ARN")}
	if err := r.Load(ctx); err != nil {
		return err
	}
	st, err := r.SetUp(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("configuration set : %s\ntopic             : %s\nevents            : %s\nsubscription      : %s (%s)\n",
		st.Name, st.TopicARN, strings.Join(st.Types, ", "), st.Subscription, st.Endpoint)
	if st.Subscription == "pending" {
		fmt.Println("SNS is calling the endpoint now; a running Mails confirms it by itself.")
	}
	fmt.Println("Saved. A running Mails picks this up on its next restart; Settings -> Reporting applies it at once.")
	return nil
}

func seedDemo(args []string) error {
	ctx := context.Background()
	pool, err := openDB(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}
	mailbox := ""
	for _, a := range args {
		switch {
		case a == "--remove":
			n, err := seed.Remove(ctx, pool)
			if err == nil {
				fmt.Printf("Removed %d demo messages.\n", n)
			}
			return err
		case strings.HasPrefix(a, "--mailbox="):
			mailbox = strings.TrimPrefix(a, "--mailbox=")
		default:
			return fmt.Errorf("unknown flag %q", a)
		}
	}
	n, err := seed.Demo(ctx, pool, mailbox, time.Now())
	if err == nil {
		fmt.Printf("Added %d demo messages. Remove them with: mails seed-demo --remove\n", n)
	}
	return err
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
