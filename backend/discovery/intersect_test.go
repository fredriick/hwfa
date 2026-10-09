package main

import (
	"testing"
	"time"
)

// A single account can query up to the budget per window, then is throttled;
// the window resets after it elapses.
func TestAllowIntersectBudget(t *testing.T) {
	s := NewStore()
	uid := "user-1"

	// Spend the whole budget in chunks under the cap.
	spent := 0
	for spent < intersectBudget {
		if !s.allowIntersect(uid, maxIntersectHashes) {
			t.Fatalf("should allow up to the budget; blocked at %d", spent)
		}
		spent += maxIntersectHashes
	}
	// Next query exceeds the budget → blocked.
	if s.allowIntersect(uid, 1) {
		t.Fatal("query past the budget must be blocked")
	}

	// A different account has its own budget.
	if !s.allowIntersect("user-2", maxIntersectHashes) {
		t.Fatal("a different account should not be throttled")
	}

	// Backdate the window so it resets, then the account can query again.
	s.mu.Lock()
	s.intersectUse[uid].windowStart = time.Now().Add(-intersectWindow - time.Second)
	s.mu.Unlock()
	if !s.allowIntersect(uid, maxIntersectHashes) {
		t.Fatal("budget should refresh after the window elapses")
	}
}
