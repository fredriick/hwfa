package main

import "testing"

// poolSize reflects the one-time prekey pool: it shrinks as bundles are handed
// out (each consumes one) and grows when the client replenishes.
func TestPoolSizeTracksConsumptionAndReplenish(t *testing.T) {
	s := NewStore()
	uid, otp, _ := s.register(sampleReq("+2348011112222"))
	s.verify(uid, otp)

	// sampleReq seeds exactly one one-time prekey.
	if n, ok := s.poolSize(uid); !ok || n != 1 {
		t.Fatalf("initial poolSize = %d (ok=%v), want 1", n, ok)
	}

	// Fetching the bundle consumes the one-time prekey.
	if _, ok := s.bundleFor(uid); !ok {
		t.Fatal("bundleFor failed")
	}
	if n, _ := s.poolSize(uid); n != 0 {
		t.Fatalf("poolSize after one fetch = %d, want 0", n)
	}

	// The client replenishes; the pool grows by exactly what was uploaded.
	added := []OneTimePreKey{{ID: 2, PublicB64: "GG"}, {ID: 3, PublicB64: "HH"}}
	if size, ok := s.addOneTime(uid, added); !ok || size != 2 {
		t.Fatalf("addOneTime returned size %d (ok=%v), want 2", size, ok)
	}
	if n, _ := s.poolSize(uid); n != 2 {
		t.Fatalf("poolSize after replenish = %d, want 2", n)
	}
}

// poolSize reports not-found for an unknown account.
func TestPoolSizeUnknownAccount(t *testing.T) {
	s := NewStore()
	if _, ok := s.poolSize("nobody"); ok {
		t.Error("poolSize should report not-found for an unknown account")
	}
}

// Deleting an account purges every device on it plus its directory entry: the
// bundle is gone, the number no longer intersects, and a linked device vanishes.
func TestDeleteAccountPurgesEverything(t *testing.T) {
	s := NewStore()
	primary, otp, _ := s.register(sampleReq("+2348011112222"))
	s.verify(primary, otp)
	token, _ := s.createLinkToken(primary)
	linked, _, _, _ := s.linkDevice(token, sampleReq(""))

	if !s.deleteAccount(primary) {
		t.Fatal("deleteAccount should succeed for a real account")
	}

	if _, ok := s.bundleFor(primary); ok {
		t.Error("primary bundle should be gone after deletion")
	}
	if _, ok := s.accountIDFor(linked); ok {
		t.Error("linked device should be gone after deletion")
	}
	if m := s.intersect([]string{s.hashPhone("+2348011112222")}); len(m) != 0 {
		t.Errorf("number should not intersect after deletion, got %v", m)
	}
	if s.deleteAccount(primary) {
		t.Error("deleting an already-deleted account should report not-found")
	}
}
