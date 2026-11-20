// Package id makes prefixed random ids such as "msg_3f9c2a...".
package id

import (
	"crypto/rand"
	"encoding/hex"
)

// New returns prefix + "_" + 24 hex characters (96 random bits).
func New(prefix string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}

// Token returns n random bytes as hex, for secrets shown once.
func Token(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
