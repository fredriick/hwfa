package main

import "testing"

func TestOriginAllowed(t *testing.T) {
	allowed := []string{"https://app.hwfa.example"}

	// Dev: anything goes.
	if !originAllowed("https://evil.example", false, allowed) {
		t.Error("dev should allow any origin")
	}

	// Prod: native clients (no Origin) are allowed.
	if !originAllowed("", true, allowed) {
		t.Error("prod should allow an empty Origin (native app)")
	}
	// Prod: an allowlisted browser Origin is allowed.
	if !originAllowed("https://app.hwfa.example", true, allowed) {
		t.Error("prod should allow an allowlisted origin")
	}
	// Prod: any other Origin is blocked.
	if originAllowed("https://evil.example", true, allowed) {
		t.Error("prod must block a non-allowlisted origin")
	}
}
