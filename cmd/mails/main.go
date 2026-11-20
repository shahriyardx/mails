// Command mails runs the whole app: API, background workers and dashboard.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/shahriyardx/mails/internal/auth"
	"github.com/shahriyardx/mails/internal/config"
	"github.com/shahriyardx/mails/internal/db"
	"github.com/shahriyardx/mails/internal/domain"
	"github.com/shahriyardx/mails/internal/mailbox"
	"github.com/shahriyardx/mails/internal/realtime"
	"github.com/shahriyardx/mails/internal/server"
	"github.com/shahriyardx/mails/internal/ses"
	"github.com/shahriyardx/mails/web"
)

func main() {
	if err := run(); err != nil {
		slog.Error("mails stopped", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if cfg.RunMigrations {
		if err := db.Migrate(ctx, pool); err != nil {
			return err
		}
		slog.Info("migrations up to date")
	}

	sesClient, err := ses.New(ctx, cfg.AWSRegion, cfg.AWSAccessKeyID, cfg.AWSSecretAccessKey)
	if err != nil {
		return err
	}
	deps := &server.Deps{
		DB:   pool,
		Cfg:  cfg,
		Auth: auth.New(pool, cfg),
		Hub:  realtime.NewHub(),
		Domains: &domain.Service{
			DB: pool, SES: sesClient, DNS: net.DefaultResolver, Region: cfg.AWSRegion,
			Selector: cfg.SESDKIMSelector, MailFromPrefix: cfg.SESMailFromPrefix, Now: time.Now,
		},
		Mailboxes: &mailbox.Service{DB: pool},
	}
	// Background workers (outbox, webhook retries) start here with ctx.

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.New(deps, web.Dist()),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	slog.Info("listening", "addr", cfg.Addr, "url", cfg.AppURL)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
