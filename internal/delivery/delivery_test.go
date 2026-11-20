package delivery_test

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/delivery"
	"github.com/shahriyardx/mails/internal/events"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/page"
	"github.com/shahriyardx/mails/internal/realtime"
	"github.com/shahriyardx/mails/internal/ses/sesfake"
)

const (
	topic   = "arn:aws:sns:us-east-1:123:ses-events"
	certURL = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-abc.pem"
)

// fakeAWS serves the signing certificate and records other fetches.
type fakeAWS struct {
	pem     []byte
	fetched []string
}

func (f *fakeAWS) Do(r *http.Request) (*http.Response, error) {
	f.fetched = append(f.fetched, r.URL.String())
	body := []byte("ok")
	if r.URL.String() == certURL {
		body = f.pem
	}
	return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(body))}, nil
}

type env struct {
	svc  *delivery.Service
	h    http.Handler
	key  *rsa.PrivateKey
	aws  *fakeAWS
	pool *pgxpool.Pool
	rec  *events.Recorder
	n    int
}

func setup(t *testing.T, topicARN string) *env {
	t.Helper()
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "sns.amazonaws.com"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour)}
	der, _ := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	aws := &fakeAWS{pem: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})}
	pool := dbtest.New(t)
	_, err := pool.Exec(context.Background(), `
		INSERT INTO mailbox (id, address, domain, display_name) VALUES ('mbx_1', 'me@a.test', 'a.test', 'Me');
		INSERT INTO thread (id, mailbox_id) VALUES ('thr_1', 'mbx_1');
		INSERT INTO message (id, thread_id, mailbox_id, from_address, to_addrs, folder, is_outbound, ses_message_id, delivery_status, sent_at)
			VALUES ('msg_1', 'thr_1', 'mbx_1', 'me@a.test', '[{"name":null,"address":"x@b.test"}]', 'sent', true, 'ses-1', 'sent', now());`)
	if err != nil {
		t.Fatal(err)
	}
	rec := &events.Recorder{}
	svc := &delivery.Service{DB: pool, SES: sesfake.New(), Hub: realtime.NewHub(), Events: rec, Now: time.Now}
	return &env{svc: svc, h: delivery.SNSHandler(svc, &delivery.Verifier{HTTP: aws}, func() string { return topicARN }), key: key, aws: aws, pool: pool, rec: rec}
}

func (e *env) post(t *testing.T, env map[string]string) int {
	t.Helper()
	keys := []string{"Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"}
	if env["Type"] != "Notification" {
		keys = []string{"Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"}
	}
	var b strings.Builder
	for _, k := range keys {
		if v, ok := env[k]; ok {
			b.WriteString(k + "\n" + v + "\n")
		}
	}
	sum := sha256.Sum256([]byte(b.String()))
	sig, _ := rsa.SignPKCS1v15(rand.Reader, e.key, crypto.SHA256, sum[:])
	if _, ok := env["Signature"]; !ok {
		env["Signature"] = base64.StdEncoding.EncodeToString(sig)
	}
	env["SignatureVersion"], env["SigningCertURL"] = "2", certURL
	body, _ := json.Marshal(env)
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, httptest.NewRequest("POST", "/api/ses/events", bytes.NewReader(body)))
	return w.Code
}

func (e *env) notify(t *testing.T, event string, snsID string) int {
	t.Helper()
	if snsID == "" {
		e.n++
		snsID = "sns-" + string(rune('a'+e.n))
	}
	return e.post(t, map[string]string{"Type": "Notification", "MessageId": snsID, "TopicArn": topic,
		"Timestamp": "2026-11-20T00:00:00Z", "Message": event})
}

func status(t *testing.T, e *env) string {
	var s string
	_ = e.pool.QueryRow(context.Background(), `SELECT delivery_status::text FROM message WHERE id = 'msg_1'`).Scan(&s)
	return s
}

func TestSNSGatekeeping(t *testing.T) {
	e := setup(t, topic)
	ev := `{"eventType":"Delivery","mail":{"messageId":"ses-1"},"delivery":{"recipients":["x@b.test"]}}`
	if c := e.post(t, map[string]string{"Type": "Notification", "MessageId": "m1", "TopicArn": "arn:aws:sns:us-east-1:999:evil", "Timestamp": "t", "Message": ev}); c != 403 {
		t.Fatalf("foreign topic: %d", c)
	}
	if c := e.post(t, map[string]string{"Type": "Notification", "MessageId": "m2", "TopicArn": topic, "Timestamp": "t", "Message": ev, "Signature": "AAAA"}); c != 401 {
		t.Fatalf("bad signature: %d", c)
	}
	if status(t, e) != "sent" {
		t.Fatal("refused message changed state")
	}
	// Subscription confirm fetches only an SNS URL.
	if c := e.post(t, map[string]string{"Type": "SubscriptionConfirmation", "MessageId": "s1", "TopicArn": topic, "Timestamp": "t",
		"Message": "m", "Token": "tok", "SubscribeURL": "https://evil.test/steal"}); c != 400 {
		t.Fatalf("foreign subscribe url: %d", c)
	}
	if c := e.post(t, map[string]string{"Type": "SubscriptionConfirmation", "MessageId": "s2", "TopicArn": topic, "Timestamp": "t",
		"Message": "m", "Token": "tok", "SubscribeURL": "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription"}); c != 200 {
		t.Fatalf("confirm: %d", c)
	}
	for _, u := range e.aws.fetched {
		if strings.Contains(u, "evil") {
			t.Fatalf("fetched %s", u)
		}
	}
	// Without a configured topic nothing is accepted.
	open := setup(t, "")
	if c := open.notify(t, ev, ""); c != 403 {
		t.Fatalf("no topic configured: %d", c)
	}
}

func TestEventsMoveStatusForwardOnly(t *testing.T) {
	e := setup(t, topic)
	steps := []struct{ event, want string }{
		{`{"eventType":"Delivery","mail":{"messageId":"ses-1"},"delivery":{"recipients":["x@b.test"]}}`, "delivered"},
		{`{"eventType":"Send","mail":{"messageId":"ses-1"}}`, "delivered"},
		{`{"eventType":"DeliveryDelay","mail":{"messageId":"ses-1"},"deliveryDelay":{"delayType":"MailboxFull"}}`, "delivered"},
		{`{"eventType":"Complaint","mail":{"messageId":"ses-1"},"complaint":{"complainedRecipients":[{"emailAddress":"X@b.test"}]}}`, "complained"},
	}
	for _, s := range steps {
		if c := e.notify(t, s.event, ""); c != 200 {
			t.Fatalf("notify: %d", c)
		}
		if got := status(t, e); got != s.want {
			t.Fatalf("after %s: status %s, want %s", s.event[:30], got, s.want)
		}
	}
	var blocked string
	_ = e.pool.QueryRow(context.Background(), `SELECT reason FROM suppression WHERE address = 'x@b.test'`).Scan(&blocked)
	if blocked != "complaint" {
		t.Fatalf("complaint did not block: %q", blocked)
	}
	if got := strings.Join(e.rec.Types(), ","); got != "email.delivered,email.delayed,email.complained" {
		t.Fatalf("webhooks = %s", got)
	}
}

func TestOpensAndRedelivery(t *testing.T) {
	e := setup(t, topic)
	open := `{"eventType":"Open","mail":{"messageId":"ses-1"},"open":{"timestamp":"2026-11-20T10:00:00Z"}}`
	e.notify(t, open, "same")
	e.notify(t, open, "same") // SNS redelivery
	e.notify(t, open, "")
	var count int
	var at time.Time
	_ = e.pool.QueryRow(context.Background(), `SELECT open_count, opened_at FROM message WHERE id = 'msg_1'`).Scan(&count, &at)
	if count != 2 || !at.Equal(time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)) {
		t.Fatalf("opens = %d at %v", count, at)
	}
	if len(e.rec.Events) != 2 {
		t.Fatalf("webhooks = %d, want 2", len(e.rec.Events))
	}
	// An event for mail we never sent is stored but changes nothing.
	if c := e.notify(t, `{"eventType":"Bounce","mail":{"messageId":"unknown"},"bounce":{"bounceType":"Permanent","bouncedRecipients":[{"emailAddress":"z@b.test"}]}}`, ""); c != 200 {
		t.Fatalf("unknown: %d", c)
	}
	var n int
	_ = e.pool.QueryRow(context.Background(), `SELECT count(*) FROM suppression`).Scan(&n)
	if n != 0 {
		t.Fatal("bounce for unknown mail blocked an address")
	}
}

func TestBounceKinds(t *testing.T) {
	e := setup(t, topic)
	e.notify(t, `{"eventType":"Bounce","mail":{"messageId":"ses-1"},"bounce":{"bounceType":"Transient","bounceSubType":"MailboxFull","bouncedRecipients":[{"emailAddress":"x@b.test"}]}}`, "")
	var n int
	_ = e.pool.QueryRow(context.Background(), `SELECT count(*) FROM suppression`).Scan(&n)
	if n != 0 {
		t.Fatal("transient bounce blocked the address")
	}
	e.notify(t, `{"eventType":"Bounce","mail":{"messageId":"ses-1"},"bounce":{"bounceType":"Permanent","bounceSubType":"General","bouncedRecipients":[{"emailAddress":"x@b.test","diagnosticCode":"550 user unknown"}]}}`, "")
	var errText string
	_ = e.pool.QueryRow(context.Background(), `SELECT delivery_error FROM message WHERE id = 'msg_1'`).Scan(&errText)
	if status(t, e) != "bounced" || errText != "550 user unknown" {
		t.Fatalf("status=%s error=%q", status(t, e), errText)
	}
	m, err := e.svc.Metrics(context.Background(), 7, "")
	if err != nil || m.Totals.Sent != 1 || m.Totals.Bounced != 1 || len(m.Bounces) != 2 || len(m.Days) != 7 {
		t.Fatalf("metrics = %+v %v", m, err)
	}
	log, err := e.svc.Log(context.Background(), delivery.LogFilter{Outbound: true, Status: "bounced", Page: page.Params{Limit: 10}})
	if err != nil || len(log.Data) != 1 {
		t.Fatalf("log = %+v %v", log, err)
	}
	o, err := e.svc.GetOverview(context.Background())
	if err != nil || o.Blocked != 1 || o.Account == nil {
		t.Fatalf("overview = %+v %v", o, err)
	}
}

func TestSuppressionCRUD(t *testing.T) {
	e := setup(t, topic)
	ctx := context.Background()
	if _, err := e.svc.Suppress(ctx, "A@b.test", ""); err != nil {
		t.Fatal(err)
	}
	var he *httpx.Error
	if _, err := e.svc.Suppress(ctx, "a@b.test", ""); !errors.As(err, &he) || he.Status != 409 {
		t.Fatalf("duplicate: %v", err)
	}
	if _, err := e.svc.Suppress(ctx, "nope", ""); !errors.As(err, &he) || he.Status != 422 {
		t.Fatalf("invalid: %v", err)
	}
	l, _ := e.svc.ListSuppressions(ctx, "b.test", page.Params{Limit: 10})
	if len(l.Data) != 1 || l.Data[0].Reason != "manual" {
		t.Fatalf("list = %+v", l.Data)
	}
	if _, err := e.svc.Unsuppress(ctx, "a@b.test"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Unsuppress(ctx, "a@b.test"); !errors.As(err, &he) || he.Status != 404 {
		t.Fatalf("second unsuppress: %v", err)
	}
}

func TestAWSURL(t *testing.T) {
	for u, want := range map[string]bool{
		"https://sns.us-east-1.amazonaws.com/x.pem":       true,
		"https://sns.cn-north-1.amazonaws.com.cn/x.pem":   true,
		"http://sns.us-east-1.amazonaws.com/x.pem":        false,
		"https://sns.us-east-1.amazonaws.com.evil.test/x": false,
		"https://evil.test/sns.us-east-1.amazonaws.com":   false,
		"https://sns.us-east-1.amazonaws.com:8443/x.pem":  false,
	} {
		if got := delivery.AWSURL(u); got != want {
			t.Errorf("AWSURL(%q) = %v", u, got)
		}
	}
}
