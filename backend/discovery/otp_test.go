package main

import (
	"testing"
	"time"
)

// A wrong code is rejected, and after too many wrong guesses the code is burned
// (deleted) so the 6-digit space can't be brute-forced — even the correct code
// no longer works and the client must request a fresh one.
func TestVerifyLocksOutAfterTooManyWrongGuesses(t *testing.T) {
	s := NewStore()
	uid, otp, ok := s.register(sampleReq("+2348011112222"))
	if !ok {
		t.Fatal("register should succeed")
	}

	for i := 0; i < maxOTPAttempts; i++ {
		if _, ok := s.verify(uid, "000000"); ok {
			t.Fatal("wrong code should never verify")
		}
	}
	// The pending code is now burned — the correct one is rejected too.
	if _, ok := s.verify(uid, otp); ok {
		t.Fatal("code should be burned after the attempt cap; a fresh one is required")
	}
}

// An expired code is rejected even if correct.
func TestVerifyRejectsExpiredCode(t *testing.T) {
	s := NewStore()
	uid, otp, _ := s.register(sampleReq("+2348011112222"))

	// Force expiry.
	s.mu.Lock()
	s.pending[uid].expiresAt = time.Now().Add(-time.Second)
	s.mu.Unlock()

	if _, ok := s.verify(uid, otp); ok {
		t.Fatal("an expired code must not verify")
	}
}

// The correct code within a few tries and before expiry still verifies.
func TestVerifySucceedsWithinLimits(t *testing.T) {
	s := NewStore()
	uid, otp, _ := s.register(sampleReq("+2348011112222"))
	s.verify(uid, "111111") // one wrong guess, under the cap
	if _, ok := s.verify(uid, otp); !ok {
		t.Fatal("correct code under the attempt cap and before expiry should verify")
	}
}

// The same number can't be issued a new code within the cooldown (SMS-bomb guard).
func TestRegisterCooldownPerNumber(t *testing.T) {
	s := NewStore()
	if _, _, ok := s.register(sampleReq("+2348011112222")); !ok {
		t.Fatal("first register should succeed")
	}
	if _, _, ok := s.register(sampleReq("+2348011112222")); ok {
		t.Fatal("a second code within the cooldown must be rejected")
	}
	// A different number is unaffected.
	if _, _, ok := s.register(sampleReq("+2348019999999")); !ok {
		t.Fatal("a different number should not be throttled")
	}
}
