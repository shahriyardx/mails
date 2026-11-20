package cloudflare

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/id"
	"github.com/shahriyardx/mails/internal/secret"
)

const (
	// ScriptName is the worker's name in the Cloudflare account.
	ScriptName  = "mails-inbound"
	compatDate  = "2024-12-01"
	provider    = "cloudflare"
	maxAttBytes = "26214400"
)

// Service manages the Cloudflare side. NewAPI is the real client in
// production and a fake in tests.
type Service struct {
	DB            *pgxpool.Pool
	Box           *secret.Box
	NewAPI        func(token string) API
	AppURL        string
	InboundSecret string
	R2Bucket      string
	Script        []byte
	// TrustAuthResults turns on the worker's reading of Cloudflare's
	// Authentication-Results header (WORKER_TRUST_AUTH_RESULTS).
	TrustAuthResults bool
}

// ErrNotConnected means no Cloudflare token is stored.
var ErrNotConnected = httpx.Invalid("", "Connect a Cloudflare token first")

// Client returns an API for the stored token and its account id.
func (s *Service) Client(ctx context.Context) (API, string, error) {
	var sealed string
	var account *string
	err := s.DB.QueryRow(ctx, `SELECT secret, account_id FROM integration WHERE provider = $1`, provider).Scan(&sealed, &account)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", ErrNotConnected
	}
	if err != nil {
		return nil, "", fmt.Errorf("load cloudflare token: %w", err)
	}
	token, err := s.Box.Open(sealed)
	if err != nil || account == nil {
		// Sealed under another SECRET: as good as not connected.
		return nil, "", ErrNotConnected
	}
	return s.NewAPI(token), *account, nil
}

// explain names the permission a refused call needed, since Cloudflare
// answers code 10000 for a bad token and a missing permission alike.
func explain(err error, needs string) error {
	if err == nil {
		return nil
	}
	if Unauthorized(err) {
		return httpx.Invalid("", "Cloudflare rejected the token. It needs "+needs+". Edit the token in Cloudflare, then reconnect it here.")
	}
	var e *Error
	if errors.As(err, &e) {
		return &httpx.Error{Status: 502, Code: "upstream_error", Message: e.Message}
	}
	return err
}

// Connect checks a token, finds its account, and stores it encrypted.
func (s *Service) Connect(ctx context.Context, token string) (*Status, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil, httpx.Invalid("token", "token: Required")
	}
	api := s.NewAPI(token)
	if err := api.VerifyToken(ctx); err != nil {
		return nil, explain(err, "to be a valid API token")
	}
	zones, err := api.Zones(ctx)
	if err != nil {
		return nil, explain(err, "Zone -> Read")
	}
	if len(zones) == 0 || zones[0].AccountID == "" {
		return nil, httpx.Invalid("token", "That token works but sees no zones. Give it Zone -> Read on your zones.")
	}
	label := fmt.Sprintf("%d zone", len(zones))
	if len(zones) != 1 {
		label += "s"
	}
	hint := "…" + token[max(0, len(token)-4):]
	_, err = s.DB.Exec(ctx, `INSERT INTO integration (id, provider, secret, hint, label, account_id, verified_at)
		VALUES ($1, $2, $3, $4, $5, $6, now())
		ON CONFLICT (provider) DO UPDATE SET secret = excluded.secret, hint = excluded.hint, label = excluded.label,
			account_id = excluded.account_id, verified_at = now()`,
		id.New("int"), provider, s.Box.Seal(token), hint, label, zones[0].AccountID)
	if err != nil {
		return nil, fmt.Errorf("store cloudflare token: %w", err)
	}
	return s.Status(ctx)
}

// Disconnect forgets the token. Nothing in Cloudflare changes.
func (s *Service) Disconnect(ctx context.Context) error {
	_, err := s.DB.Exec(ctx, `DELETE FROM integration WHERE provider = $1`, provider)
	return err
}

// ZoneStatus says whether a zone's mail reaches the worker.
type ZoneStatus struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	RoutingEnabled   bool   `json:"routing_enabled"`
	CatchAllToWorker bool   `json:"catch_all_to_worker"`
}

// Status is what the inbound settings page shows.
type Status struct {
	Connected   bool         `json:"connected"`
	Hint        string       `json:"hint,omitempty"`
	Label       string       `json:"label,omitempty"`
	AccountID   string       `json:"account_id,omitempty"`
	ScriptName  string       `json:"script_name"`
	ScriptBytes int          `json:"script_bytes"`
	Deployed    bool         `json:"deployed"`
	ModifiedOn  *time.Time   `json:"modified_on,omitempty"`
	Zones       []ZoneStatus `json:"zones"`
	Error       string       `json:"error,omitempty"`
}

// Status reads the connection, the worker and every zone. Cloudflare being
// unreachable is reported in Error, not returned.
func (s *Service) Status(ctx context.Context) (*Status, error) {
	st := &Status{ScriptName: ScriptName, ScriptBytes: len(s.Script), Zones: []ZoneStatus{}}
	var hint, label, account *string
	err := s.DB.QueryRow(ctx, `SELECT hint, label, account_id FROM integration WHERE provider = $1`, provider).Scan(&hint, &label, &account)
	if errors.Is(err, pgx.ErrNoRows) {
		return st, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load integration: %w", err)
	}
	st.Connected, st.Hint, st.Label, st.AccountID = true, deref(hint), deref(label), deref(account)
	api, acct, err := s.Client(ctx)
	if err != nil {
		st.Error = "The stored token cannot be read. Connect it again."
		return st, nil
	}
	if st.ModifiedOn, err = api.WorkerModified(ctx, acct, ScriptName); err != nil {
		st.Error = explain(err, "Workers Scripts -> Read").Error()
		return st, nil
	}
	st.Deployed = st.ModifiedOn != nil
	zones, err := api.Zones(ctx)
	if err != nil {
		st.Error = explain(err, "Zone -> Read").Error()
		return st, nil
	}
	for _, z := range zones {
		zs := ZoneStatus{ID: z.ID, Name: z.Name}
		zs.RoutingEnabled, _ = api.RoutingEnabled(ctx, z.ID)
		worker, _ := api.CatchAllWorker(ctx, z.ID)
		zs.CatchAllToWorker = worker == ScriptName
		st.Zones = append(st.Zones, zs)
	}
	return st, nil
}

// Deploy uploads the bundled worker with its R2 binding and the shared
// secret. Redeploying is the same call.
func (s *Service) Deploy(ctx context.Context) error {
	if strings.Contains(s.AppURL, "localhost") || strings.Contains(s.AppURL, "127.0.0.1") {
		return httpx.Invalid("", "APP_URL points at this machine. Cloudflare has to be able to reach the app.")
	}
	api, account, err := s.Client(ctx)
	if err != nil {
		return err
	}
	err = api.UploadWorker(ctx, account, ScriptName, s.Script, compatDate, []string{"nodejs_compat"}, []Binding{
		{Type: "r2_bucket", Name: "ATTACHMENTS", Bucket: s.R2Bucket},
		{Type: "plain_text", Name: "APP_INBOUND_URL", Text: s.AppURL + "/api/inbound"},
		{Type: "plain_text", Name: "STORE_RAW", Text: "true"},
		{Type: "plain_text", Name: "MAX_ATTACHMENT_BYTES", Text: maxAttBytes},
		{Type: "plain_text", Name: "FORWARD_TO", Text: ""},
		{Type: "plain_text", Name: "TRUST_AUTH_RESULTS", Text: strconv.FormatBool(s.TrustAuthResults)},
		{Type: "secret_text", Name: "INBOUND_WEBHOOK_SECRET", Text: s.InboundSecret},
	})
	return explain(err, "Workers Scripts -> Edit and Workers R2 Storage -> Edit")
}

// RemoveWorker deletes the worker from Cloudflare.
func (s *Service) RemoveWorker(ctx context.Context) error {
	api, account, err := s.Client(ctx)
	if err != nil {
		return err
	}
	return explain(api.DeleteWorker(ctx, account, ScriptName), "Workers Scripts -> Edit")
}

// zoneName finds a zone's name; Email Routing's enable call needs it.
func zoneName(ctx context.Context, api API, zoneID string) (string, error) {
	zones, err := api.Zones(ctx)
	if err != nil {
		return "", explain(err, "Zone -> Read")
	}
	for _, z := range zones {
		if z.ID == zoneID {
			return z.Name, nil
		}
	}
	return "", httpx.NotFound("This token cannot see that zone")
}

// RouteZone turns Email Routing on for a zone and points its catch-all at
// the worker.
func (s *Service) RouteZone(ctx context.Context, zoneID string) error {
	api, _, err := s.Client(ctx)
	if err != nil {
		return err
	}
	name, err := zoneName(ctx, api, zoneID)
	if err != nil {
		return err
	}
	const needs = "Zone Settings -> Edit (which gates turning Email Routing on), Email Routing Rules -> Edit and DNS -> Edit"
	on, err := api.RoutingEnabled(ctx, zoneID)
	if err != nil {
		return explain(err, needs)
	}
	if !on {
		if err := api.SetRouting(ctx, zoneID, name, true); err != nil {
			return explain(err, needs)
		}
	}
	return explain(api.SetCatchAll(ctx, zoneID, ScriptName), needs)
}

// UnrouteZone stops the catch-all and, when asked, Email Routing itself.
func (s *Service) UnrouteZone(ctx context.Context, zoneID string, disableRouting bool) error {
	api, _, err := s.Client(ctx)
	if err != nil {
		return err
	}
	const needs = "Zone Settings -> Edit and Email Routing Rules -> Edit"
	if err := api.SetCatchAll(ctx, zoneID, ""); err != nil {
		return explain(err, needs)
	}
	if disableRouting {
		return explain(api.SetRouting(ctx, zoneID, "", false), needs)
	}
	return nil
}

// Receiving reports what EnsureSubdomainReceiving did.
type Receiving struct {
	State  string `json:"state"` // published, already, skipped
	Domain string `json:"domain,omitempty"`
	Zone   string `json:"zone,omitempty"`
	Reason string `json:"reason,omitempty"`
}

// EnsureSubdomainReceiving publishes Email Routing MX records for a
// subdomain of a zone whose catch-all already reaches the worker (the
// catch-all covers subdomains once their MX points at Cloudflare). It never
// touches a subdomain that has MX records of its own.
func (s *Service) EnsureSubdomainReceiving(ctx context.Context, domain string) Receiving {
	api, _, err := s.Client(ctx)
	if err != nil {
		return Receiving{State: "skipped", Reason: "No Cloudflare token is connected"}
	}
	zones, err := api.Zones(ctx)
	if err != nil {
		return Receiving{State: "skipped", Reason: explain(err, "Zone -> Read").Error()}
	}
	var zone *Zone
	for i, z := range zones {
		if strings.HasSuffix(domain, "."+z.Name) && (zone == nil || len(z.Name) > len(zone.Name)) {
			zone = &zones[i]
		}
	}
	if zone == nil {
		return Receiving{State: "skipped", Reason: "Not a subdomain of a zone on this Cloudflare account"}
	}
	if worker, err := api.CatchAllWorker(ctx, zone.ID); err != nil || worker != ScriptName {
		return Receiving{State: "skipped", Reason: zone.Name + " is not receiving mail here yet"}
	}
	n, err := api.MXCount(ctx, zone.ID, domain)
	if err != nil {
		return Receiving{State: "skipped", Reason: explain(err, "DNS -> Read").Error()}
	}
	if n > 0 {
		return Receiving{State: "already"}
	}
	for _, mx := range EmailRoutingMX {
		if err := api.AddMX(ctx, zone.ID, domain, mx, "Added by Mails so this subdomain receives mail"); err != nil {
			return Receiving{State: "skipped", Reason: explain(err, "DNS -> Edit").Error()}
		}
	}
	return Receiving{State: "published", Domain: domain, Zone: zone.Name}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
