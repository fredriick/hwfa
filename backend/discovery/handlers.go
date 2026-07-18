package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"
)

// handlers holds the Discovery HTTP handlers over a shared Store. Registration
// and verification are unauthenticated; key fetch/upload and contact discovery
// require the bearer token issued at verification.
type handlers struct {
	store *Store
	// devOTP echoes the OTP in the register response when true (DISCOVERY_DEV=1),
	// so headless tests can verify without an SMS gateway. Off in production.
	devOTP bool
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("discovery: encode response: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// bearerUser extracts and validates the Authorization: Bearer token, returning
// the authenticated userID.
func (h *handlers) bearerUser(r *http.Request) (string, bool) {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return "", false
	}
	token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	if token == "" {
		return "", false
	}
	return h.store.userForToken(token)
}

// POST /v1/accounts/register — store phone hash + key material, "send" an OTP.
func (h *handlers) register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.PhoneNumber == "" || req.IdentityKeyB64 == "" {
		writeError(w, http.StatusBadRequest, "missing phoneNumber or identity key")
		return
	}
	if req.DeviceID == 0 {
		req.DeviceID = 1
	}

	userID, otp := h.store.register(req)
	// Production: hand the OTP to an SMS gateway (Termii / Africa's Talking).
	// Phase 1 spike: log it, and optionally echo it for headless tests.
	log.Printf("discovery: OTP for %s (device %d): %s", userID, req.DeviceID, otp)

	resp := RegisterResponse{UserID: userID, OTPSent: true}
	if h.devOTP {
		resp.DevOTP = otp
	}
	writeJSON(w, http.StatusOK, resp)
}

// POST /v1/accounts/verify — check the OTP, mark verified, issue a token.
func (h *handlers) verify(w http.ResponseWriter, r *http.Request) {
	var req VerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	token, ok := h.store.verify(req.UserID, req.Code)
	if !ok {
		writeError(w, http.StatusUnauthorized, "invalid userId or code")
		return
	}
	writeJSON(w, http.StatusOK, VerifyResponse{Verified: true, Token: token})
}

// GET /v1/keys/{userId} — fetch a peer's bundle, consuming one one-time prekey.
func (h *handlers) fetchKeys(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.bearerUser(r); !ok {
		writeError(w, http.StatusUnauthorized, "missing or invalid token")
		return
	}
	target := r.PathValue("userId")
	bundle, ok := h.store.bundleFor(target)
	if !ok {
		writeError(w, http.StatusNotFound, "no verified account for that user")
		return
	}
	writeJSON(w, http.StatusOK, bundle)
}

// PUT /v1/keys/upload — replenish the caller's own one-time prekey pool.
func (h *handlers) uploadKeys(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.bearerUser(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing or invalid token")
		return
	}
	var req UploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	size, ok := h.store.addOneTime(userID, req.OneTimePreKeys)
	if !ok {
		writeError(w, http.StatusNotFound, "account not found")
		return
	}
	writeJSON(w, http.StatusOK, UploadResponse{PoolSize: size})
}

// GET /v1/contacts/salt — the salt clients use to hash contacts before intersect.
func (h *handlers) salt(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.bearerUser(r); !ok {
		writeError(w, http.StatusUnauthorized, "missing or invalid token")
		return
	}
	writeJSON(w, http.StatusOK, SaltResponse{SaltB64: h.store.saltB64()})
}

// POST /v1/contacts/intersect — privacy-preserving contact discovery. (The spec
// names it GET, but the hash set needs a body; see IntersectRequest.)
func (h *handlers) intersect(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.bearerUser(r); !ok {
		writeError(w, http.StatusUnauthorized, "missing or invalid token")
		return
	}
	var req IntersectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	writeJSON(w, http.StatusOK, IntersectResponse{Matches: h.store.intersect(req.PhoneHashesB64)})
}
