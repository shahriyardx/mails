// Package avatar finds a picture for a sender: their Gravatar, else their
// domain's BIMI brand logo, else the domain's site icon. The server does
// the lookup and serves the result from its own origin, so the browser
// never tells an outside service who mails you. Results (and misses) are
// cached in the avatar table.
package avatar

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/addr"
)

const (
	maxBytes = 128 << 10
	hitTTL   = 7 * 24 * time.Hour
	missTTL  = 24 * time.Hour
	timeout  = 4 * time.Second
)

// Image is a picture to serve.
type Image struct {
	ContentType string
	Data        []byte
}

// Doer fetches URLs; production passes a safehttp client.
type Doer interface {
	Do(*http.Request) (*http.Response, error)
}

// Resolver looks up TXT records; *net.Resolver satisfies it.
type Resolver interface {
	LookupTXT(ctx context.Context, name string) ([]string, error)
}

// Service finds and caches pictures.
type Service struct {
	DB   *pgxpool.Pool
	HTTP Doer
	DNS  Resolver
	Now  func() time.Time
}

// slots bounds outside lookups running at once.
var slots = make(chan struct{}, 4)

// freemail domains host many unrelated people: their logo or icon is not
// the sender's picture.
var freemail = map[string]bool{
	"gmail.com": true, "googlemail.com": true, "outlook.com": true, "hotmail.com": true, "live.com": true,
	"yahoo.com": true, "icloud.com": true, "me.com": true, "proton.me": true, "protonmail.com": true,
	"aol.com": true, "gmx.com": true, "yandex.com": true, "mail.com": true, "zoho.com": true, "fastmail.com": true,
}

// Get returns the sender's picture, or nil when there is none.
func (s *Service) Get(ctx context.Context, address string) (*Image, error) {
	a, ok := addr.Parse(address)
	if !ok {
		return nil, nil
	}
	if img, err := s.cached(ctx, "g:"+a.Address, func(ctx context.Context) (*Image, error) { return s.gravatar(ctx, a.Address) }); img != nil || err != nil {
		return img, err
	}
	domain := addr.DomainOf(a.Address)
	if freemail[domain] {
		return nil, nil
	}
	return s.cached(ctx, "d:"+domain, func(ctx context.Context) (*Image, error) { return s.brand(ctx, domain) })
}

// cached returns the stored result for key, or runs find and stores it.
func (s *Service) cached(ctx context.Context, key string, find func(context.Context) (*Image, error)) (*Image, error) {
	var found bool
	var ct *string
	var data []byte
	var at time.Time
	err := s.DB.QueryRow(ctx, `SELECT found, content_type, data, fetched_at FROM avatar WHERE key = $1`, key).Scan(&found, &ct, &data, &at)
	switch {
	case err == nil && found && s.Now().Sub(at) < hitTTL:
		return &Image{ContentType: deref(ct), Data: data}, nil
	case err == nil && !found && s.Now().Sub(at) < missTTL:
		return nil, nil
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return nil, fmt.Errorf("avatar cache: %w", err)
	}
	select {
	case slots <- struct{}{}:
		defer func() { <-slots }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	img, _ := find(ctx) // a failed lookup is a miss, cached like one
	var outCT *string
	var outData []byte
	if img != nil {
		outCT, outData = &img.ContentType, img.Data
	}
	if _, err := s.DB.Exec(ctx, `INSERT INTO avatar (key, found, content_type, data, fetched_at) VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (key) DO UPDATE SET found = excluded.found, content_type = excluded.content_type, data = excluded.data, fetched_at = excluded.fetched_at`,
		key, img != nil, outCT, outData, s.Now()); err != nil {
		return nil, fmt.Errorf("avatar store: %w", err)
	}
	return img, nil
}

// gravatar asks Gravatar by the address's SHA-256, with d=404 so a missing
// picture is a 404, not a placeholder.
func (s *Service) gravatar(ctx context.Context, address string) (*Image, error) {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(address))))
	return s.fetch(ctx, "https://www.gravatar.com/avatar/"+hex.EncodeToString(sum[:])+"?d=404&s=128", false)
}

// brand finds a domain's picture: its BIMI logo (on the domain or its
// parent), else its site icon.
func (s *Service) brand(ctx context.Context, domain string) (*Image, error) {
	for _, d := range []string{domain, parent(domain)} {
		if d == "" {
			continue
		}
		if logo := s.bimi(ctx, d); logo != nil {
			return logo, nil
		}
	}
	for _, path := range []string{"/apple-touch-icon.png", "/favicon.ico"} {
		if img, _ := s.fetch(ctx, "https://"+domain+path, false); img != nil {
			return img, nil
		}
	}
	return nil, nil
}

// bimi reads default._bimi.<domain> ("v=BIMI1; l=https://...svg") and
// fetches the SVG logo it names.
func (s *Service) bimi(ctx context.Context, domain string) *Image {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	records, err := s.DNS.LookupTXT(ctx, "default._bimi."+domain)
	if err != nil {
		return nil
	}
	for _, r := range records {
		if !strings.HasPrefix(strings.TrimSpace(r), "v=BIMI1") {
			continue
		}
		for _, part := range strings.Split(r, ";") {
			if k, v, ok := strings.Cut(strings.TrimSpace(part), "="); ok && k == "l" && strings.HasPrefix(v, "https://") {
				if img, _ := s.fetch(ctx, strings.TrimSpace(v), true); img != nil {
					return img
				}
			}
		}
	}
	return nil
}

// fetch downloads an image of at most maxBytes. svg allows image/svg+xml.
func (s *Service) fetch(ctx context.Context, url string, svg bool) (*Image, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mails")
	res, err := s.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, nil
	}
	ct, _, _ := mime.ParseMediaType(res.Header.Get("Content-Type"))
	allowed := map[string]bool{"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true,
		"image/x-icon": true, "image/vnd.microsoft.icon": true}
	if !allowed[ct] && !(svg && ct == "image/svg+xml") {
		return nil, nil
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, maxBytes+1))
	if err != nil || len(data) == 0 || len(data) > maxBytes {
		return nil, err
	}
	return &Image{ContentType: ct, Data: data}, nil
}

// parent is the domain one label up ("mail.example.com" -> "example.com"),
// or "" when that would be a bare TLD.
func parent(domain string) string {
	_, rest, ok := strings.Cut(domain, ".")
	if !ok || !strings.Contains(rest, ".") {
		return ""
	}
	return rest
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// Handler serves GET /api/app/avatar?address=<email>: the picture, or a
// 404 the browser may cache, so the page shows initials.
func Handler(s *Service) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		img, err := s.Get(r.Context(), r.URL.Query().Get("address"))
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		if err != nil || img == nil {
			h.Set("Cache-Control", "private, max-age=3600")
			w.WriteHeader(http.StatusNotFound)
			return
		}
		h.Set("Content-Type", img.ContentType)
		// An SVG logo is only ever drawn as an image, never run as a page.
		h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
		h.Set("Cache-Control", "private, max-age=86400")
		_, _ = w.Write(img.Data)
	})
}
