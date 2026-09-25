package authtoken

import (
	"testing"
	"time"
)

func TestSignVerifyRoundTrip(t *testing.T) {
	secret := []byte("test-secret")
	tok := Sign(secret, "user-123", time.Hour)
	uid, ok := Verify(secret, tok)
	if !ok || uid != "user-123" {
		t.Fatalf("Verify = (%q, %v), want (user-123, true)", uid, ok)
	}
}

func TestVerifyRejectsWrongSecret(t *testing.T) {
	tok := Sign([]byte("secret-a"), "user-123", time.Hour)
	if _, ok := Verify([]byte("secret-b"), tok); ok {
		t.Fatal("a token signed with a different secret must not verify")
	}
}

func TestVerifyRejectsTampered(t *testing.T) {
	secret := []byte("test-secret")
	tok := Sign(secret, "user-123", time.Hour)
	// Flip the last character of the payload segment.
	b := []byte(tok)
	b[0] ^= 0x01
	if _, ok := Verify(secret, string(b)); ok {
		t.Fatal("a tampered token must not verify")
	}
}

func TestVerifyRejectsExpired(t *testing.T) {
	secret := []byte("test-secret")
	tok := Sign(secret, "user-123", -time.Second) // already expired
	if _, ok := Verify(secret, tok); ok {
		t.Fatal("an expired token must not verify")
	}
}

func TestVerifyRejectsGarbage(t *testing.T) {
	secret := []byte("test-secret")
	for _, bad := range []string{"", "nodot", "a.b.c", "...", "!.@"} {
		if _, ok := Verify(secret, bad); ok {
			t.Fatalf("garbage token %q must not verify", bad)
		}
	}
}
