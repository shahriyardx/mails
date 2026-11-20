package inbound

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/shahriyardx/mails/internal/httpx"
)

// maxBody bounds a request. Bodies only: attachments are already in R2.
const maxBody = 40 << 20

// maxSkew is how old (or how far ahead) a signed timestamp may be.
const maxSkew = 5 * time.Minute

// Handler serves POST /api/inbound.
func Handler(s *Service, secret string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				httpx.JSON(w, 413, map[string]string{"error": "payload too large"})
				return
			}
			httpx.JSON(w, 400, map[string]string{"error": "unreadable body"})
			return
		}
		if !Verify(secret, body, r.Header.Get("X-Mail-Signature"), r.Header.Get("X-Mail-Timestamp"), s.Now()) {
			httpx.JSON(w, 401, map[string]string{"error": "invalid signature"})
			return
		}
		var in struct {
			Email       *Payload     `json:"email"`
			Attachments []Attachment `json:"attachments"`
		}
		if err := json.Unmarshal(body, &in); err != nil {
			httpx.JSON(w, 400, map[string]string{"error": "invalid json"})
			return
		}
		if in.Email == nil || in.Email.From.Address == "" {
			httpx.JSON(w, 400, map[string]string{"error": "missing sender"})
			return
		}
		res, err := s.Ingest(r.Context(), in.Email, in.Attachments)
		if err != nil {
			// A 500 makes Cloudflare retry; Message-ID dedupe makes that safe.
			slog.Error("inbound ingest failed", "err", err)
			httpx.JSON(w, 500, map[string]string{"error": "ingest failed"})
			return
		}
		forward := res.Forward
		if forward == nil {
			forward = []string{}
		}
		if len(res.Stored) == 0 {
			// No mailbox owns the address: the worker rejects it unless
			// forward names somewhere to send it instead.
			httpx.JSON(w, 202, map[string]any{"stored": 0, "reason": "no mailbox", "forward": forward})
			return
		}
		httpx.JSON(w, 200, map[string]any{"stored": len(res.Stored), "forward": forward})
	})
}

// Verify checks the worker's HMAC-SHA256 signature over "timestamp.body"
// in constant time, and that the millisecond timestamp is recent.
func Verify(secret string, body []byte, signature, timestamp string, now time.Time) bool {
	if secret == "" || signature == "" || timestamp == "" {
		return false
	}
	ms, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	if skew := now.Sub(time.UnixMilli(ms)); skew > maxSkew || skew < -maxSkew {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(body)
	want := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(want), []byte(signature))
}
