// Package domain manages sending domains: the SES identity, its DKIM key,
// the custom MAIL FROM, the DNS records the owner publishes, and checks that
// those records resolve.
package domain

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/id"
	"github.com/shahriyardx/mails/internal/ses"
)

// staleAfter is how long an SES status is trusted before a list refreshes it.
const staleAfter = 10 * time.Minute

// Domain is one row, shaped as the public API returns it.
type Domain struct {
	Object              string     `json:"object" db:"-"`
	ID                  string     `json:"id" db:"id"`
	Name                string     `json:"name" db:"name"`
	Region              string     `json:"region" db:"region"`
	Status              string     `json:"status" db:"status"`
	SendingEnabled      bool       `json:"sending_enabled" db:"sending_enabled"`
	DKIMStatus          string     `json:"dkim_status" db:"dkim_status"`
	DKIMOrigin          *string    `json:"dkim_origin" db:"dkim_origin"`
	DKIMTokens          []string   `json:"-" db:"dkim_tokens"`
	DKIMPublicKey       *string    `json:"-" db:"dkim_public_key"`
	MailFromDomain      *string    `json:"mail_from_domain" db:"mail_from_domain"`
	MailFromStatus      *string    `json:"mail_from_status" db:"mail_from_status"`
	SPFVerified         bool       `json:"spf_verified" db:"spf_verified"`
	DMARCVerified       bool       `json:"dmarc_verified" db:"dmarc_verified"`
	InheritedFrom       *string    `json:"inherited_from" db:"inherited_from"`
	AutoCreateMailboxes bool       `json:"auto_create_mailboxes" db:"auto_create_mailboxes"`
	ForwardOff          bool       `json:"forward_off" db:"forward_off"`
	Imported            bool       `json:"imported" db:"-"`
	ImportedAt          *time.Time `json:"-" db:"imported_at"`
	LastCheckedAt       *time.Time `json:"last_checked_at" db:"last_checked_at"`
	CreatedAt           time.Time  `json:"created_at" db:"created_at"`
	Records             []Record   `json:"records" db:"-"`
}

// Sendable reports whether SES will send from this domain.
func (d *Domain) Sendable() bool { return d.SendingEnabled && d.Status == "verified" }

const columns = `id, name, region, status::text, sending_enabled, dkim_status::text, dkim_origin,
	dkim_tokens, dkim_public_key, mail_from_domain, mail_from_status::text, spf_verified,
	dmarc_verified, inherited_from, auto_create_mailboxes, forward_off, imported_at,
	last_checked_at, created_at`

// Resolver looks up TXT records. *net.Resolver satisfies it.
type Resolver interface {
	LookupTXT(ctx context.Context, name string) ([]string, error)
}

// Service holds what domain operations need. Every field is required.
type Service struct {
	DB             *pgxpool.Pool
	SES            ses.Client
	DNS            Resolver
	Region         string
	Selector       string // DKIM selector for keys we generate
	MailFromPrefix string // "mail" gives mail.example.com
	Now            func() time.Time
}

func finish(d *Domain) *Domain {
	d.Object = "domain"
	d.Imported = d.ImportedAt != nil
	d.Records = Records(d)
	return d
}

func (s *Service) query(ctx context.Context, where string, args ...any) ([]*Domain, error) {
	rows, _ := s.DB.Query(ctx, `SELECT `+columns+` FROM domain `+where, args...)
	list, err := pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[Domain])
	if err != nil {
		return nil, fmt.Errorf("query domains: %w", err)
	}
	for _, d := range list {
		finish(d)
	}
	return list, nil
}

// List returns every domain, by name.
func (s *Service) List(ctx context.Context) ([]*Domain, error) {
	return s.query(ctx, `ORDER BY name`)
}

// Get finds a domain by id or by name.
func (s *Service) Get(ctx context.Context, idOrName string) (*Domain, error) {
	list, err := s.query(ctx, `WHERE id = $1 OR name = lower($1)`, idOrName)
	if err != nil {
		return nil, err
	}
	if len(list) == 0 {
		return nil, httpx.NotFound("No such domain")
	}
	return list[0], nil
}

// Add creates the SES identity with a DKIM key we generate (one TXT record
// instead of three CNAMEs) and a custom MAIL FROM. A subdomain of a verified
// domain needs no identity: SES lets it send on the parent's verification,
// so it is recorded as inherited and has no records.
func (s *Service) Add(ctx context.Context, raw string) (*Domain, error) {
	name, ok := addr.NormalizeDomain(raw)
	if !ok {
		return nil, httpx.Invalid("name", "That does not look like a domain name")
	}
	all, err := s.List(ctx)
	if err != nil {
		return nil, err
	}
	var parent *Domain
	for _, d := range all {
		if d.Name == name {
			return nil, httpx.Conflict("That domain is already here")
		}
		if d.Sendable() && d.InheritedFrom == nil && addr.IsUnder(name, d.Name) &&
			(parent == nil || len(d.Name) > len(parent.Name)) {
			parent = d
		}
	}
	now := s.Now()
	newID := id.New("dom")

	if parent != nil {
		_, err := s.DB.Exec(ctx, `INSERT INTO domain (id, name, region, status, sending_enabled, dkim_status, inherited_from, last_checked_at)
			VALUES ($1, $2, $3, 'verified', true, 'verified', $4, $5)`, newID, name, parent.Region, parent.Name, now)
		if err != nil {
			return nil, fmt.Errorf("insert inherited domain: %w", err)
		}
		return s.afterChange(ctx, newID)
	}

	known, err := s.SES.GetIdentity(ctx, name)
	if err != nil {
		return nil, err
	}
	if known == nil {
		if err := s.SES.CreateIdentity(ctx, name); err != nil {
			return nil, err
		}
		known = &ses.Identity{VerificationStatus: "PENDING", DKIMStatus: "PENDING"}
	}

	// An identity that already has an external key keeps it: its record is
	// already published and we cannot reproduce it.
	tokens, dkimStatus, origin := known.DKIMTokens, known.DKIMStatus, known.DKIMOrigin
	var publicKey *string
	if origin != "EXTERNAL" {
		priv, pub, err := newDKIMKey()
		if err != nil {
			return nil, err
		}
		sel := Selector(s.Selector)
		st, toks, err := s.SES.PutExternalDKIM(ctx, name, sel, priv)
		if err != nil {
			return nil, err
		}
		if len(toks) == 0 {
			toks = []string{sel}
		}
		tokens, dkimStatus, origin, publicKey = toks, st, "EXTERNAL", &pub
	}

	var mailFrom, mailFromStatus *string
	mf := s.MailFromPrefix + "." + name
	if err := s.SES.SetMailFrom(ctx, name, mf); err != nil {
		// Not fatal: SES falls back to amazonses.com as the return path.
		slog.Warn("set mail from failed", "domain", name, "err", err)
	} else {
		pending := "pending"
		mailFrom, mailFromStatus = &mf, &pending
	}
	var importedAt *time.Time
	if known.Name != "" {
		importedAt = &now
	}
	_, err = s.DB.Exec(ctx, `INSERT INTO domain (id, name, region, status, sending_enabled, dkim_status, dkim_origin,
			dkim_tokens, dkim_public_key, mail_from_domain, mail_from_status, imported_at, last_checked_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::domain_status, $12, $13)`,
		newID, name, s.Region, ses.Status(known.VerificationStatus), known.SendingEnabled, ses.Status(dkimStatus),
		nullIfEmpty(origin), tokens, publicKey, mailFrom, mailFromStatus, importedAt, now)
	if err != nil {
		return nil, fmt.Errorf("insert domain: %w", err)
	}
	return s.afterChange(ctx, newID)
}

// Refresh asks SES where the identity stands and probes SPF and DMARC.
func (s *Service) Refresh(ctx context.Context, idOrName string) (*Domain, error) {
	d, err := s.Get(ctx, idOrName)
	if err != nil {
		return nil, err
	}
	if d.InheritedFrom != nil {
		return d, nil // it stands or falls with its parent
	}
	detail, err := s.SES.GetIdentity(ctx, d.Name)
	if err != nil {
		return nil, err
	}
	if detail == nil {
		_, err = s.DB.Exec(ctx, `UPDATE domain SET status = 'failed', sending_enabled = false, last_checked_at = $2 WHERE id = $1`, d.ID, s.Now())
		if err != nil {
			return nil, fmt.Errorf("mark domain failed: %w", err)
		}
		return s.Get(ctx, d.ID)
	}
	spf, dmarc := s.probe(ctx, d.Name)
	if err := s.save(ctx, d, detail, &spf, &dmarc); err != nil {
		return nil, err
	}
	return s.afterChange(ctx, d.ID)
}

func (s *Service) save(ctx context.Context, d *Domain, detail *ses.Identity, spf, dmarc *bool) error {
	tokens := detail.DKIMTokens
	if len(tokens) == 0 {
		tokens = d.DKIMTokens
	}
	var mfStatus *string
	if detail.MailFromStatus != "" {
		st := ses.Status(detail.MailFromStatus)
		mfStatus = &st
	}
	_, err := s.DB.Exec(ctx, `UPDATE domain SET status = $2, sending_enabled = $3, dkim_status = $4, dkim_origin = $5,
			dkim_tokens = $6, mail_from_domain = $7, mail_from_status = $8::domain_status,
			spf_verified = coalesce($9, spf_verified), dmarc_verified = coalesce($10, dmarc_verified), last_checked_at = $11
		WHERE id = $1`,
		d.ID, ses.Status(detail.VerificationStatus), detail.SendingEnabled, ses.Status(detail.DKIMStatus),
		nullIfEmpty(detail.DKIMOrigin), tokens, nullIfEmpty(detail.MailFromDomain), mfStatus, spf, dmarc, s.Now())
	if err != nil {
		return fmt.Errorf("update domain %s: %w", d.Name, err)
	}
	return nil
}

// Remove deletes the row and, when asked, the SES identity. An inherited
// subdomain never deletes an identity: it has none, and deleting the
// parent's would take every sibling down.
func (s *Service) Remove(ctx context.Context, idOrName string, inSES bool) (*Domain, bool, error) {
	d, err := s.Get(ctx, idOrName)
	if err != nil {
		return nil, false, err
	}
	deleted := false
	if inSES && d.InheritedFrom == nil {
		if err := s.SES.DeleteIdentity(ctx, d.Name); err != nil {
			slog.Warn("delete ses identity failed", "domain", d.Name, "err", err)
		} else {
			deleted = true
		}
	}
	if _, err := s.DB.Exec(ctx, `DELETE FROM domain WHERE id = $1`, d.ID); err != nil {
		return nil, false, fmt.Errorf("delete domain: %w", err)
	}
	return d, deleted, nil
}

// Settings changes the owner's per-domain switches. Nil leaves one as is.
func (s *Service) Settings(ctx context.Context, idOrName string, autoCreate, forwardOff *bool) (*Domain, error) {
	d, err := s.Get(ctx, idOrName)
	if err != nil {
		return nil, err
	}
	_, err = s.DB.Exec(ctx, `UPDATE domain SET auto_create_mailboxes = coalesce($2, auto_create_mailboxes),
		forward_off = coalesce($3, forward_off) WHERE id = $1`, d.ID, autoCreate, forwardOff)
	if err != nil {
		return nil, fmt.Errorf("update domain settings: %w", err)
	}
	return s.Get(ctx, d.ID)
}

// UseOwnDKIMKey moves an imported domain onto a key we generate, so its
// DKIM record becomes one TXT record we can show. The private half goes to
// SES and is dropped; only the public half is stored.
func (s *Service) UseOwnDKIMKey(ctx context.Context, idOrName string) (*Domain, error) {
	d, err := s.Get(ctx, idOrName)
	if err != nil {
		return nil, err
	}
	if d.InheritedFrom != nil {
		return nil, httpx.Invalid("", "This domain uses its parent's key")
	}
	priv, pub, err := newDKIMKey()
	if err != nil {
		return nil, err
	}
	sel := Selector(s.Selector)
	st, toks, err := s.SES.PutExternalDKIM(ctx, d.Name, sel, priv)
	if err != nil {
		return nil, err
	}
	if len(toks) == 0 {
		toks = []string{sel}
	}
	_, err = s.DB.Exec(ctx, `UPDATE domain SET dkim_origin = 'EXTERNAL', dkim_status = $2, dkim_tokens = $3,
		dkim_public_key = $4, last_checked_at = $5 WHERE id = $1`, d.ID, ses.Status(st), toks, pub, s.Now())
	if err != nil {
		return nil, fmt.Errorf("save dkim key: %w", err)
	}
	return s.Get(ctx, d.ID)
}

// ImportResult counts what Import changed.
type ImportResult struct {
	Imported int `json:"imported"`
	Updated  int `json:"updated"`
	Total    int `json:"total"`
}

// Import pulls every SES domain identity in and upserts it. Safe to repeat.
func (s *Service) Import(ctx context.Context) (ImportResult, error) {
	ids, err := s.SES.ListIdentities(ctx)
	if err != nil {
		return ImportResult{}, err
	}
	var res ImportResult
	for _, item := range ids {
		if item.Type != "" && item.Type != "DOMAIN" {
			continue
		}
		res.Total++
		detail, err := s.SES.GetIdentity(ctx, item.Name)
		if err != nil {
			return res, err
		}
		if detail == nil {
			continue
		}
		existing, err := s.Get(ctx, item.Name)
		var nf *httpx.Error
		switch {
		case errors.As(err, &nf) && nf.Status == 404:
			_, err = s.DB.Exec(ctx, `INSERT INTO domain (id, name, region, imported_at) VALUES ($1, $2, $3, $4)`,
				id.New("dom"), item.Name, s.Region, s.Now())
			if err != nil {
				return res, fmt.Errorf("insert imported domain: %w", err)
			}
			if existing, err = s.Get(ctx, item.Name); err != nil {
				return res, err
			}
			res.Imported++
		case err != nil:
			return res, err
		default:
			res.Updated++
		}
		if err := s.save(ctx, existing, detail, nil, nil); err != nil {
			return res, err
		}
	}
	return res, s.linkMailboxes(ctx)
}

// ListFresh returns the list, first re-importing from SES when it is empty
// or stale. SES being unreachable does not fail the list: warning carries the
// reason for the page to show beside the rows it has.
func (s *Service) ListFresh(ctx context.Context) (list []*Domain, warning string, err error) {
	list, err = s.List(ctx)
	if err != nil {
		return nil, "", err
	}
	stale := len(list) == 0
	for _, d := range list {
		if d.LastCheckedAt == nil || s.Now().Sub(*d.LastCheckedAt) > staleAfter {
			stale = true
		}
	}
	if !stale {
		return list, "", nil
	}
	if _, syncErr := s.Import(ctx); syncErr != nil {
		slog.Warn("domain sync failed", "err", syncErr)
		return list, "Could not reach SES: " + ses.Explain(syncErr), nil
	}
	list, err = s.List(ctx)
	return list, "", err
}

func (s *Service) afterChange(ctx context.Context, domainID string) (*Domain, error) {
	if err := s.linkMailboxes(ctx); err != nil {
		return nil, err
	}
	return s.Get(ctx, domainID)
}

// linkMailboxes points mailboxes at their domain row once it exists.
func (s *Service) linkMailboxes(ctx context.Context) error {
	_, err := s.DB.Exec(ctx, `UPDATE mailbox m SET domain_id = d.id FROM domain d
		WHERE m.domain_id IS NULL AND d.name = m.domain`)
	if err != nil {
		return fmt.Errorf("link mailboxes: %w", err)
	}
	return nil
}

// probe checks whether SPF (including amazonses.com) and DMARC resolve.
func (s *Service) probe(ctx context.Context, name string) (spf, dmarc bool) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if txt, err := s.DNS.LookupTXT(ctx, name); err == nil {
		spf = strings.Contains(strings.Join(txt, " "), "include:amazonses.com")
	}
	if txt, err := s.DNS.LookupTXT(ctx, "_dmarc."+name); err == nil {
		dmarc = strings.Contains(strings.ToLower(strings.Join(txt, " ")), "v=dmarc1")
	}
	return spf, dmarc
}

// newDKIMKey makes an RSA 2048 key: private as base64 PKCS#8 DER (what SES
// takes), public as base64 SPKI DER (what goes after p= in DNS).
func newDKIMKey() (priv, pub string, err error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return "", "", fmt.Errorf("generate dkim key: %w", err)
	}
	p8, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return "", "", err
	}
	spki, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return "", "", err
	}
	return base64.StdEncoding.EncodeToString(p8), base64.StdEncoding.EncodeToString(spki), nil
}

var notLabel = regexp.MustCompile(`[^a-z0-9-]`)

// Selector cleans a DKIM selector to one DNS label, defaulting to "mail".
func Selector(v string) string {
	v = strings.Trim(notLabel.ReplaceAllString(strings.ToLower(v), ""), "-")
	if v == "" {
		return "mail"
	}
	return v
}

// Record is one DNS record the owner publishes.
type Record struct {
	Kind          string `json:"kind"` // CNAME, TXT, MX
	Name          string `json:"name"`
	Value         string `json:"value"`
	Priority      int    `json:"priority,omitempty"`
	Purpose       string `json:"purpose"`
	Required      bool   `json:"required"`
	Informational bool   `json:"informational,omitempty"`
}

// Records lists the DNS a domain needs to send and receive.
func Records(d *Domain) []Record {
	if d.InheritedFrom != nil {
		return []Record{}
	}
	external := d.DKIMOrigin != nil && *d.DKIMOrigin == "EXTERNAL"
	out := make([]Record, 0, len(d.DKIMTokens)+4)
	tokens := append([]string(nil), d.DKIMTokens...)
	sort.Strings(tokens)
	for _, t := range tokens {
		name := t + "._domainkey." + d.Name
		switch {
		case external && d.DKIMPublicKey != nil:
			out = append(out, Record{Kind: "TXT", Name: name, Value: "p=" + *d.DKIMPublicKey, Purpose: "DKIM signing", Required: true})
		case external:
			// A key set up elsewhere: we know the selector, not the key.
			out = append(out, Record{Kind: "TXT", Name: name, Value: "already published by whoever set this domain up",
				Purpose: "DKIM signing", Required: true, Informational: true})
		default:
			out = append(out, Record{Kind: "CNAME", Name: name, Value: t + ".dkim.amazonses.com", Purpose: "DKIM signing", Required: true})
		}
	}
	if d.MailFromDomain != nil && *d.MailFromDomain != "" {
		out = append(out,
			Record{Kind: "MX", Name: *d.MailFromDomain, Value: "feedback-smtp." + d.Region + ".amazonses.com", Priority: 10, Purpose: "Bounce return path", Required: true},
			Record{Kind: "TXT", Name: *d.MailFromDomain, Value: "v=spf1 include:amazonses.com ~all", Purpose: "SPF for return path", Required: true})
	}
	return append(out,
		Record{Kind: "TXT", Name: d.Name, Value: "v=spf1 include:amazonses.com include:_spf.mx.cloudflare.net ~all", Purpose: "SPF for SES + Cloudflare", Required: true},
		Record{Kind: "TXT", Name: "_dmarc." + d.Name, Value: "v=DMARC1; p=none; rua=mailto:dmarc@" + d.Name, Purpose: "DMARC policy"})
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
