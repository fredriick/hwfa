package main

import "testing"

// A linked device joins the primary's account: it gets its own userID but shares
// the accountID, both devices appear in devicesFor, and only the primary keeps a
// phone hash (so contact discovery still points at one account).
func TestLinkDeviceJoinsAccount(t *testing.T) {
	s := NewStore()

	primary, otp, _ := s.register(sampleReq("+2348011112222"))
	if _, ok := s.verify(primary, otp); !ok {
		t.Fatal("primary verify failed")
	}

	token, ttl := s.createLinkToken(primary)
	if ttl <= 0 {
		t.Fatal("expected a positive link TTL")
	}

	linkReq := sampleReq("") // phone ignored on link
	secondary, accountID, bearer, ok := s.linkDevice(token, linkReq)
	if !ok {
		t.Fatal("linkDevice failed")
	}
	if accountID != primary {
		t.Errorf("linked accountID = %q, want primary %q", accountID, primary)
	}
	if secondary == primary {
		t.Error("linked device should get its own userID")
	}
	if uid, ok := s.userForToken(bearer); !ok || uid != secondary {
		t.Errorf("bearer token resolves to %q (ok=%v), want %q", uid, ok, secondary)
	}

	// Both devices belong to the account.
	devices := s.devicesFor(primary)
	if len(devices) != 2 {
		t.Fatalf("devicesFor(primary) = %v, want 2 devices", devices)
	}

	// A recipient resolves either device to the same account.
	if acc, _ := s.accountIDFor(secondary); acc != primary {
		t.Errorf("accountIDFor(secondary) = %q, want %q", acc, primary)
	}

	// The linked device is not independently discoverable by phone (no hash),
	// so intersect on the primary's number still yields exactly one account.
	hash := s.hashPhone("+2348011112222")
	matches := s.intersect([]string{hash})
	if len(matches) != 1 || matches[0].UserID != primary {
		t.Errorf("intersect = %v, want single match on primary %q", matches, primary)
	}
}

// A single-device user is its own account: devicesFor returns just itself, so a
// sender can always fan out over the list.
func TestDevicesForSingleDevice(t *testing.T) {
	s := NewStore()
	uid, otp, _ := s.register(sampleReq("+2348010000001"))
	s.verify(uid, otp)

	devices := s.devicesFor(uid)
	if len(devices) != 1 || devices[0] != uid {
		t.Errorf("devicesFor = %v, want [%s]", devices, uid)
	}
}

// An unknown or reused link token is rejected (one-time use).
func TestLinkTokenIsSingleUse(t *testing.T) {
	s := NewStore()
	primary, otp, _ := s.register(sampleReq("+2348011112222"))
	s.verify(primary, otp)

	token, _ := s.createLinkToken(primary)
	if _, _, _, ok := s.linkDevice(token, sampleReq("")); !ok {
		t.Fatal("first link should succeed")
	}
	if _, _, _, ok := s.linkDevice(token, sampleReq("")); ok {
		t.Fatal("reusing a link token must fail")
	}
	if _, _, _, ok := s.linkDevice("not-a-real-token", sampleReq("")); ok {
		t.Fatal("unknown link token must fail")
	}
}
