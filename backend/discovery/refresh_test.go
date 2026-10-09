package main

import "testing"

// A valid refresh token buys a fresh access token; garbage and access tokens
// (wrong kind) are rejected.
func TestRefreshExchangesForAccess(t *testing.T) {
	s := NewStore()
	uid, otp, _ := s.register(sampleReq("+2348011112222"))
	access, refresh, _ := s.verify(uid, otp)

	// The access token is usable now, and is an access-kind token.
	if u, ok := s.userForToken(access); !ok || u != uid {
		t.Fatal("access token should resolve to the user")
	}

	newAccess, newRefresh, ok := s.refresh(refresh)
	if !ok || newAccess == "" || newRefresh == "" {
		t.Fatal("refresh should mint a new token pair")
	}
	if u, ok := s.userForToken(newAccess); !ok || u != uid {
		t.Fatal("refreshed access token should resolve to the user")
	}

	// An access token is not a valid refresh credential (wrong kind).
	if _, _, ok := s.refresh(access); ok {
		t.Error("an access token must not work at the refresh endpoint")
	}
	// Garbage is rejected.
	if _, _, ok := s.refresh("not-a-token"); ok {
		t.Error("garbage refresh token must be rejected")
	}
}

// Deleting the account revokes refresh: access can no longer be renewed.
func TestRefreshFailsAfterAccountDeleted(t *testing.T) {
	s := NewStore()
	uid, otp, _ := s.register(sampleReq("+2348011112222"))
	_, refresh, _ := s.verify(uid, otp)

	s.deleteAccount(uid)
	if _, _, ok := s.refresh(refresh); ok {
		t.Error("refresh must fail after the account is deleted")
	}
}

// Revoking a linked device revokes its refresh (its access dies within the TTL).
func TestRefreshFailsAfterDeviceRevoked(t *testing.T) {
	s := NewStore()
	primary, otp, _ := s.register(sampleReq("+2348011112222"))
	s.verify(primary, otp)
	token, _ := s.createLinkToken(primary)
	linked, _, _, linkedRefresh, _ := s.linkDevice(token, sampleReq(""))

	// The linked device can refresh while it exists.
	if _, _, ok := s.refresh(linkedRefresh); !ok {
		t.Fatal("linked device should refresh while active")
	}
	// After revocation it cannot.
	if !s.removeDevice(primary, linked) {
		t.Fatal("revoke should succeed")
	}
	if _, _, ok := s.refresh(linkedRefresh); ok {
		t.Error("refresh must fail after the device is revoked")
	}
}
