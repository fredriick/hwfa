package main

import (
	"path/filepath"
	"testing"
)

// A fully-populated register request for one account.
func sampleReq(phone string) RegisterRequest {
	return RegisterRequest{
		PhoneNumber:              phone,
		DeviceID:                 1,
		RegistrationID:           42,
		IdentityKeyB64:           "AAAA",
		SignedPreKeyID:           1,
		SignedPreKeyPublicB64:    "BBBB",
		SignedPreKeySignatureB64: "CCCC",
		KyberPreKeyID:            1,
		KyberPreKeyPublicB64:     "DDDD",
		KyberPreKeySignatureB64:  "EEEE",
		OneTimePreKeys:           []OneTimePreKey{{ID: 1, PublicB64: "FFFF"}},
	}
}

// A persistent store must reload its salt + verified accounts after a restart,
// so contact discovery keeps matching the same phone hashes.
func TestPersistentStore_SurvivesRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "disc.json")

	// First boot: register + verify an account.
	s1 := NewPersistentStore(path)
	uid, otp := s1.register(sampleReq("+2348011112222"))
	if _, ok := s1.verify(uid, otp); !ok {
		t.Fatal("verify failed on first boot")
	}
	saltBefore := s1.saltB64()
	hash := s1.hashPhone("+2348011112222")

	// Second boot from the same file: state must come back.
	s2 := NewPersistentStore(path)
	if s2.saltB64() != saltBefore {
		t.Fatalf("salt changed across restart: %s != %s", s2.saltB64(), saltBefore)
	}
	if got := s2.hashPhone("+2348011112222"); got != hash {
		t.Fatalf("phone hash changed across restart: %s != %s", got, hash)
	}
	matches := s2.intersect([]string{hash})
	if len(matches) != 1 || matches[0].UserID != uid {
		t.Fatalf("account not discoverable after restart: %+v (want uid=%s)", matches, uid)
	}
	if _, ok := s2.bundleFor(uid); !ok {
		t.Fatal("verified bundle not fetchable after restart")
	}
}

// An in-memory store (no path) must not touch the disk and stays ephemeral.
func TestInMemoryStore_NoPersistence(t *testing.T) {
	s := NewStore()
	uid, otp := s.register(sampleReq("+2348010000001"))
	if _, ok := s.verify(uid, otp); !ok {
		t.Fatal("verify failed")
	}
	if s.path != "" {
		t.Fatal("in-memory store should have no path")
	}
}

// A one-time prekey consumed before a restart must not be reissued after it.
func TestPersistentStore_ConsumedPrekeyNotReissued(t *testing.T) {
	path := filepath.Join(t.TempDir(), "disc.json")

	s1 := NewPersistentStore(path)
	uid, otp := s1.register(sampleReq("+2348011112222"))
	s1.verify(uid, otp)
	b1, _ := s1.bundleFor(uid) // consumes the single one-time prekey
	if b1.OneTimePreKeyID == nil {
		t.Fatal("expected a one-time prekey on first fetch")
	}

	s2 := NewPersistentStore(path)
	b2, _ := s2.bundleFor(uid)
	if b2.OneTimePreKeyID != nil {
		t.Fatalf("consumed prekey was reissued after restart: %d", *b2.OneTimePreKeyID)
	}
}
