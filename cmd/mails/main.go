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
	"runtime/debug"
	"sync"
	"syscall"
	"time"

	"github.com/shahriyardx/mails/internal/apikey"
	"github.com/shahriyardx/mails/internal/apiv1"
	"github.com/shahriyardx/mails/internal/auth"
	"github.com/shahriyardx/mails/internal/avatar"
	"github.com/shahriyardx/mails/internal/cloudflare"
	"github.com/shahriyardx/mails/internal/config"
	"github.com/shahriyardx/mails/internal/db"
	"github.com/shahriyardx/mails/internal/delivery"
	"github.com/shahriyardx/mails/internal/domain"
	"github.com/shahriyardx/mails/internal/forwarding"
	"github.com/shahriyardx/mails/internal/idempotency"
	"github.com/shahriyardx/mails/internal/inbound"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/mailbox"
	"github.com/shahriyardx/mails/internal/push"
	"github.com/shahriyardx/mails/internal/realtime"
	"github.com/shahriyardx/mails/internal/reporting"
	"github.com/shahriyardx/mails/internal/safehttp"
	"github.com/shahriyardx/mails/internal/secret"
	"github.com/shahriyardx/mails/internal/send"
	"github.com/shahriyardx/mails/internal/server"
	"github.com/shahriyardx/mails/internal/ses"
	"github.com/shahriyardx/mails/internal/setup"
	"github.com/shahriyardx/mails/internal/storage"
	"github.com/shahriyardx/mails/internal/webhook"
	"github.com/shahriyardx/mails/web"
	"github.com/shahriyardx/mails/worker"
)

func main() {
	if handled, err := command(os.Args[1:]); handled {
		if err != nil {
			slog.Error("command failed", "err", err)
			os.Exit(1)
		}
		return
	}
	if err := run(); err != nil {
		slog.Error("mails stopped", "err", err)
		os.Exit(1)
	}
}

// every runs fn now and then on each tick until ctx ends, logging failures.
func every(ctx context.Context, d time.Duration, name string, fn func(context.Context) error) {
	t := time.NewTicker(d)
	defer t.Stop()
	for {
		if err := fn(ctx); err != nil && ctx.Err() == nil {
			slog.Error(name+" failed", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
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

	awsCfg, err := ses.Config(ctx, cfg.AWSRegion, cfg.AWSAccessKeyID, cfg.AWSSecretAccessKey)
	if err != nil {
		return err
	}
	sesClient := ses.New(awsCfg)
	reports := &reporting.Service{DB: pool, AWS: reporting.NewAWS(awsCfg), AppURL: cfg.AppURL,
		EnvConfigSet: cfg.SESConfigSet, EnvTopicARN: cfg.SESSNSTopicARN}
	if err := reports.Load(ctx); err != nil {
		return err
	}
	var store storage.Store
	if cfg.R2AccountID != "" && cfg.R2AccessKeyID != "" {
		store = storage.NewR2(cfg.R2AccountID, cfg.R2AccessKeyID, cfg.R2SecretAccessKey, cfg.R2Bucket)
	} else {
		slog.Warn("R2 is not configured: attachments are kept in memory and lost on restart")
		store = storage.NewMemory()
	}
	pusher := &push.Service{DB: pool, PublicKey: cfg.VAPIDPublicKey}
	if cfg.VAPIDPublicKey != "" && cfg.VAPIDPrivateKey != "" {
		pusher.Send = push.WebPush(cfg.VAPIDPublicKey, cfg.VAPIDPrivateKey, cfg.VAPIDSubject)
	}
	hooks := &webhook.Service{DB: pool, HTTP: safehttp.Client(10*time.Second, !cfg.Secure()), Now: time.Now, AllowLocal: !cfg.Secure()}
	hub := realtime.NewHub()
	mailSvc := &mail.Service{DB: pool, Store: store, Hub: hub, OnWake: pusher.OnWake}
	box, err := secret.New(cfg.Secret)
	if err != nil {
		return err
	}
	cf := &cloudflare.Service{
		DB: pool, Box: box, NewAPI: cloudflare.NewAPI, AppURL: cfg.AppURL,
		InboundSecret: cfg.InboundSecret, R2Bucket: cfg.R2Bucket, Script: worker.Script,
		TrustAuthResults: cfg.WorkerTrustAuthResults,
	}
	mailboxes := &mailbox.Service{DB: pool, Receiving: func(ctx context.Context, d string) any { return cf.EnsureSubdomainReceiving(ctx, d) }}
	sender := &send.Service{
		DB: pool, SES: sesClient, Store: store, Mailboxes: mailboxes, Mail: mailSvc, Hub: hub,
		ConfigSet: reports.ConfigSet, Region: cfg.AWSRegion, Now: time.Now, Events: hooks,
	}
	deps := &server.Deps{
		DB:   pool,
		Cfg:  cfg,
		Auth: auth.New(pool, cfg),
		Hub:  hub,
		Domains: &domain.Service{
			DB: pool, SES: sesClient, DNS: net.DefaultResolver, Region: cfg.AWSRegion,
			Selector: cfg.SESDKIMSelector, MailFromPrefix: cfg.SESMailFromPrefix, Now: time.Now,
		},
		Mailboxes: mailboxes,
		Inbound: &inbound.Service{DB: pool, Hub: hub, Now: time.Now,
			OnReceived: []func(context.Context, inbound.Received){pusher.OnReceived}, Events: hooks},
		Mail:      mailSvc,
		Send:      sender,
		Delivery:  &delivery.Service{DB: pool, SES: sesClient, Hub: hub, Events: hooks, Now: time.Now},
		SNS:       &delivery.Verifier{HTTP: &http.Client{Timeout: 10 * time.Second}},
		CF:        cf,
		Forward:   &forwarding.Manager{DB: pool, CF: cf},
		Push:      pusher,
		Setup:     &setup.Service{DB: pool, SESConfigured: cfg.AWSAccessKeyID != "", Region: cfg.AWSRegion},
		Keys:      &apikey.Service{DB: pool},
		Webhooks:  hooks,
		Reporting: reports,
		Avatars:   &avatar.Service{DB: pool, HTTP: avatarClient(cfg.Secure()), DNS: net.DefaultResolver, Now: time.Now},
	}
	idem := &idempotency.Store{DB: pool}
	deps.V1 = &apiv1.API{
		DB: pool, Keys: deps.Keys, Domains: deps.Domains, Mailboxes: mailboxes, Mail: mailSvc, Send: sender,
		Delivery: deps.Delivery, Webhooks: hooks, Idem: idem, Events: hooks, BaseURL: cfg.AppURL + "/api/v1",
	}
	// Background workers stop claiming work when ctx ends but finish the job
	// in hand; run waits for them before closing the pool.
	var workers sync.WaitGroup
	workers.Go(func() { every(ctx, time.Hour, "sweep staged uploads", mailSvc.SweepStaged) })
	workers.Go(func() { every(ctx, time.Hour, "sweep idempotency keys", idem.Sweep) })
	workers.Go(func() { every(ctx, 30*time.Second, "wake snoozed threads", mailSvc.WakeSnoozed) })
	workers.Go(func() { hooks.Run(ctx) })
	if cfg.OutboxWorker {
		workers.Go(func() { sender.RunOutbox(ctx) })
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.New(deps, web.Dist()),
		ReadHeaderTimeout: 10 * time.Second,
	}
	srv.RegisterOnShutdown(hub.Close)
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdown); err != nil {
			slog.Warn("shutdown", "err", err)
		}
	}()
	// Start-up (migrations, client setup) leaves garbage behind; hand it
	// back now so an idle instance stays small.
	debug.FreeOSMemory()
	slog.Info("listening", "addr", cfg.Addr, "url", cfg.AppURL)
	err = srv.ListenAndServe()
	// ListenAndServe returns as soon as shutdown starts (or at once if it
	// could not listen): wait for in-flight requests and workers before
	// the deferred pool.Close.
	stop()
	<-shutdownDone
	workers.Wait()
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}

// avatarClient fetches sender pictures. Site icons often redirect
// (example.com -> www.example.com), so it follows a few; every hop still
// dials through safehttp's private-address check.
func avatarClient(secure bool) *http.Client {
	c := safehttp.Client(5*time.Second, !secure)
	c.CheckRedirect = func(_ *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return http.ErrUseLastResponse
		}
		return nil
	}
	return c
}
