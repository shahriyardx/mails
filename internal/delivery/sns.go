// Package delivery records what happens to mail after SES takes it: SNS
// notifications for deliveries, bounces, complaints and opens; the blocked
// list they feed; and the delivery log, metrics and SES overview.
package delivery

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
)

// Envelope is an SNS HTTP message.
type Envelope struct {
	Type             string
	MessageId        string
	TopicArn         string
	Subject          *string
	Message          string
	Timestamp        string
	SignatureVersion string
	Signature        string
	SigningCertURL   string
	SubscribeURL     string
	Token            string
}

// HTTPDoer fetches URLs. *http.Client satisfies it; tests pass a fake.
type HTTPDoer interface {
	Do(*http.Request) (*http.Response, error)
}

var snsHost = regexp.MustCompile(`^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$`)

// AWSURL reports whether u is an https URL on an SNS endpoint. Both the
// signing certificate and the subscribe link must be, or a forged message
// could make us fetch anything.
func AWSURL(u string) bool {
	p, err := url.Parse(u)
	return err == nil && p.Scheme == "https" && snsHost.MatchString(p.Hostname()) && p.Port() == ""
}

// Verifier checks SNS signatures. Certificates are cached by URL.
type Verifier struct {
	HTTP  HTTPDoer
	mu    sync.Mutex
	certs map[string]*x509.Certificate
}

// Verify checks e's signature against the AWS certificate it names.
func (v *Verifier) Verify(ctx context.Context, e *Envelope) error {
	if !AWSURL(e.SigningCertURL) || !strings.HasSuffix(e.SigningCertURL, ".pem") {
		return errors.New("signing certificate is not on an SNS endpoint")
	}
	cert, err := v.cert(ctx, e.SigningCertURL)
	if err != nil {
		return err
	}
	key, ok := cert.PublicKey.(*rsa.PublicKey)
	if !ok {
		return errors.New("certificate key is not RSA")
	}
	sig, err := base64.StdEncoding.DecodeString(e.Signature)
	if err != nil {
		return errors.New("signature is not base64")
	}
	msg := []byte(stringToSign(e))
	switch e.SignatureVersion {
	case "1":
		sum := sha1.Sum(msg)
		return rsa.VerifyPKCS1v15(key, crypto.SHA1, sum[:], sig)
	case "2":
		sum := sha256.Sum256(msg)
		return rsa.VerifyPKCS1v15(key, crypto.SHA256, sum[:], sig)
	default:
		return fmt.Errorf("unknown signature version %q", e.SignatureVersion)
	}
}

func (v *Verifier) cert(ctx context.Context, u string) (*x509.Certificate, error) {
	v.mu.Lock()
	if c, ok := v.certs[u]; ok {
		v.mu.Unlock()
		return c, nil
	}
	v.mu.Unlock()
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, err
	}
	res, err := v.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch sns certificate: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("fetch sns certificate: status %d", res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, 64<<10))
	if err != nil {
		return nil, fmt.Errorf("read sns certificate: %w", err)
	}
	block, _ := pem.Decode(body)
	if block == nil {
		return nil, errors.New("sns certificate is not PEM")
	}
	c, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse sns certificate: %w", err)
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.certs == nil || len(v.certs) > 32 {
		v.certs = map[string]*x509.Certificate{} // AWS rotates rarely; a reset is cheap
	}
	v.certs[u] = c
	return c, nil
}

// stringToSign is the canonical form SNS signs: selected keys in order,
// each as "Key\nValue\n", skipping absent ones.
func stringToSign(e *Envelope) string {
	type kv struct{ k, v string }
	var fields []kv
	if e.Type == "Notification" {
		fields = []kv{{"Message", e.Message}, {"MessageId", e.MessageId}}
		if e.Subject != nil {
			fields = append(fields, kv{"Subject", *e.Subject})
		}
		fields = append(fields, kv{"Timestamp", e.Timestamp}, kv{"TopicArn", e.TopicArn}, kv{"Type", e.Type})
	} else {
		fields = []kv{{"Message", e.Message}, {"MessageId", e.MessageId}, {"SubscribeURL", e.SubscribeURL},
			{"Timestamp", e.Timestamp}, {"Token", e.Token}, {"TopicArn", e.TopicArn}, {"Type", e.Type}}
	}
	var b strings.Builder
	for _, f := range fields {
		b.WriteString(f.k + "\n" + f.v + "\n")
	}
	return b.String()
}
