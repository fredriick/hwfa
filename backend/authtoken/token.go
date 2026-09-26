// Package authtoken issues and verifies the compact, HMAC-signed bearer tokens
// shared across Hwfa's services. Discovery signs one when a phone/device is
// verified; the relay and media services verify it locally — no cross-service
// call — using the same shared secret (HWFA_TOKEN_SECRET).
//
// A token is `<base64url(payload)>.<base64url(hmac-sha256(payload))>`, where the
// payload is `{"uid":<userID>,"exp":<unix seconds>}`. It is stateless (no server
// store), tamper-evident, and self-expiring — a strict improvement over the
// prior opaque, never-expiring, per-service tokens.
package authtoken

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log"
	"os"
	"strings"
	"time"
)

// devSecret keeps dev + headless tests working with no configuration; all three
// services fall back to it so they interoperate out of the box. Production MUST
// set HWFA_TOKEN_SECRET (see SecretFromEnv).
const devSecret = "hwfa-dev-insecure-shared-secret-change-me"

type claims struct {
	UID string `json:"uid"`
	Exp int64  `json:"exp"` // unix seconds
}

// Sign returns a signed token for uid, valid for ttl.
func Sign(secret []byte, uid string, ttl time.Duration) string {
	payload, _ := json.Marshal(claims{UID: uid, Exp: time.Now().Add(ttl).Unix()})
	p := b64(payload)
	return p + "." + b64(mac(secret, p))
}

// Verify checks the signature and expiry, returning the uid on success.
func Verify(secret []byte, token string) (uid string, ok bool) {
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 {
		return "", false
	}
	expected := b64(mac(secret, parts[0]))
	// Constant-time comparison so a timing side-channel can't forge the MAC.
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", false
	}
	var c claims
	if err := json.Unmarshal(raw, &c); err != nil {
		return "", false
	}
	if time.Now().Unix() >= c.Exp {
		return "", false
	}
	return c.UID, true
}

// IsProduction reports whether the service is running in production
// (HWFA_ENV=production), which turns dev conveniences into hard failures.
func IsProduction() bool { return os.Getenv("HWFA_ENV") == "production" }

// resolveSecret is the pure decision behind SecretFromEnv, split out so it can
// be tested without a process-exiting log.Fatal: in production a missing secret
// is an error; in dev it falls back to the shared insecure constant.
func resolveSecret(envSecret string, prod bool) ([]byte, error) {
	if envSecret != "" {
		return []byte(envSecret), nil
	}
	if prod {
		return nil, errors.New("HWFA_TOKEN_SECRET must be set in production")
	}
	return []byte(devSecret), nil
}

// SecretFromEnv returns the shared signing secret from HWFA_TOKEN_SECRET. In
// production a missing secret is fatal; in dev it falls back to the insecure
// constant with a loud warning. Call once at startup.
func SecretFromEnv() []byte {
	env := os.Getenv("HWFA_TOKEN_SECRET")
	b, err := resolveSecret(env, IsProduction())
	if err != nil {
		log.Fatalf("authtoken: %v", err)
	}
	if env == "" {
		log.Printf("authtoken: HWFA_TOKEN_SECRET unset — using the INSECURE dev secret (never in production)")
	}
	return b
}

func mac(secret []byte, msg string) []byte {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(msg))
	return h.Sum(nil)
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }
