package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"hwfa/authtoken"
)

// The presign endpoints must reject a request with no / a bad bearer token.
// (R2 is unconfigured in tests, so a *valid* token falls through to 503 — which
// still proves the auth gate let it past.)
func TestMediaEndpointsRequireToken(t *testing.T) {
	s := newServer()

	// No token → 401.
	req := httptest.NewRequest(http.MethodPost, "/v1/media/upload-url", nil)
	rec := httptest.NewRecorder()
	s.uploadURL(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("upload-url without token = %d, want 401", rec.Code)
	}

	// Bad token → 401.
	req = httptest.NewRequest(http.MethodGet, "/v1/media/download-url?locator=abc", nil)
	req.Header.Set("Authorization", "Bearer not-a-real-token")
	rec = httptest.NewRecorder()
	s.downloadURL(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("download-url with bad token = %d, want 401", rec.Code)
	}

	// Valid token → past the auth gate (503 because R2 isn't configured here).
	tok := authtoken.Sign(authtoken.SecretFromEnv(), "user-1", time.Hour)
	req = httptest.NewRequest(http.MethodPost, "/v1/media/upload-url", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec = httptest.NewRecorder()
	s.uploadURL(rec, req)
	if rec.Code == http.StatusUnauthorized {
		t.Errorf("upload-url with valid token was rejected as unauthorized")
	}
}
