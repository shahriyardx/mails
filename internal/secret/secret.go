// Package secret encrypts values stored at rest (the Cloudflare token) with
// AES-256-GCM under a key derived from the SECRET setting.
package secret

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
)

const prefix = "v1:"

// Box seals and opens secrets.
type Box struct{ aead cipher.AEAD }

// New derives the key from the app secret. A different SECRET makes every
// stored value unreadable, which Open reports as an error.
func New(appSecret string) (*Box, error) {
	if len(appSecret) < 16 {
		return nil, errors.New("SECRET must be at least 16 characters")
	}
	key, err := hkdf.Key(sha256.New, []byte(appSecret), []byte("mails"), "secret-box v1", 32)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead: aead}, nil
}

// Seal encrypts plain.
func (b *Box) Seal(plain string) string {
	nonce := make([]byte, b.aead.NonceSize())
	_, _ = rand.Read(nonce)
	return prefix + base64.RawURLEncoding.EncodeToString(b.aead.Seal(nonce, nonce, []byte(plain), nil))
}

// Open decrypts a value from Seal.
func (b *Box) Open(sealed string) (string, error) {
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(sealed, prefix))
	if err != nil || !strings.HasPrefix(sealed, prefix) || len(raw) < b.aead.NonceSize() {
		return "", errors.New("malformed secret")
	}
	n := b.aead.NonceSize()
	plain, err := b.aead.Open(nil, raw[:n], raw[n:], nil)
	if err != nil {
		return "", errors.New("secret was sealed with a different SECRET")
	}
	return string(plain), nil
}
