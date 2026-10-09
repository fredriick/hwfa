package authtoken

import (
	"testing"
	"time"
)

func TestSignVerifyRoundTrip(t *testing.T) {
	secret := []byte("test-secret")
	tok := Sign(secret, "user-123", KindAccess, time.Hour)
	uid, kind, ok := Verify(secret, tok)
	if !ok || uid != "user-123" || kind != KindAccess {
		t.Fatalf("Verify = (%q, %q, %v), want (user-123, access, true)", uid, kind, ok)
	}
}

func TestVerifyRejectsWrongSecret(t *testing.T) {
	tok := Sign([]byte("secret-a"), "user-123", KindAccess, time.Hour)
	if _, _, ok := Verify([]byte("secret-b"), tok); ok {
		t.Fatal("a token signed with a different secret must not verify")
	}
}

func TestVerifyRejectsTampered(t *testing.T) {
	secret := []byte("test-secret")
	tok := Sign(secret, "user-123", KindAccess, time.Hour)
	b := []byte(tok)
	b[0] ^= 0x01
	if _, _, ok := Verify(secret, string(b)); ok {
		t.Fatal("a tampered token must not verify")
	}
}

func TestVerifyRejectsExpired(t *testing.T) {
	secret := []byte("test-secret")
	tok := Sign(secret, "user-123", KindAccess, -time.Second)
	if _, _, ok := Verify(secret, tok); ok {
		t.Fatal("an expired token must not verify")
	}
}

func TestVerifyReportsKind(t *testing.T) {
	secret := []byte("test-secret")
	tok := Sign(secret, "u", KindRefresh, time.Hour)
	if _, kind, ok := Verify(secret, tok); !ok || kind != KindRefresh {
		t.Fatalf("refresh token kind = %q (ok=%v), want refresh", kind, ok)
	}
}

func TestResolveSecret(t *testing.T) {
	if b, err := resolveSecret("abc", false); err != nil || string(b) != "abc" {
		t.Errorf("dev+set = (%q,%v), want (abc,nil)", b, err)
	}
	if b, err := resolveSecret("abc", true); err != nil || string(b) != "abc" {
		t.Errorf("prod+set = (%q,%v), want (abc,nil)", b, err)
	}
	if b, err := resolveSecret("", false); err != nil || string(b) != devSecret {
		t.Errorf("dev+unset should fall back to the dev secret, got (%q,%v)", b, err)
	}
	if _, err := resolveSecret("", true); err == nil {
		t.Error("prod+unset must be an error (no insecure fallback in production)")
	}
}

func TestVerifyRejectsGarbage(t *testing.T) {
	secret := []byte("test-secret")
	for _, bad := range []string{"", "nodot", "a.b.c", "...", "!.@"} {
		if _, _, ok := Verify(secret, bad); ok {
			t.Fatalf("garbage token %q must not verify", bad)
		}
	}
}
