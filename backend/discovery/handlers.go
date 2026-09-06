package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"
)

// handlers holds the Discovery HTTP handlers over a shared Store. Registration
// and verification are unauthenticated; key fetch/upload and contact discovery
// require the bearer token issued at verification.
type handlers struct {
	store *Store
	// sms delivers the OTP over SMS. In dev / headless tests this is the no-op
	// log gateway; with TextBee configured it sends a real message.
	sms SMSGateway
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
	// Hand the OTP to the SMS gateway (TextBee in production; a no-op that only
	// logs in dev). Delivery runs in the background so a slow gateway doesn't
	// stall registration; the client proceeds to the verify step regardless.
	log.Printf("discovery: OTP for %s (device %d) issued", userID, req.DeviceID)
	if h.sms != nil {
		phone := req.PhoneNumber
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			if err := h.sms.SendOTP(ctx, phone, otp); err != nil {
				log.Printf("discovery: SMS delivery failed for %s: %v", userID, err)
			}
		}()
	}

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

// GET /v1/keys/pool — how many one-time prekeys the caller has left, so the
// client knows whether to replenish.
func (h *handlers) keyPool(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.bearerUser(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing or invalid token")
		return
	}
	size, ok := h.store.poolSize(userID)
	if !ok {
		writeError(w, http.StatusNotFound, "account not found")
		return
	}
	writeJSON(w, http.StatusOK, UploadResponse{PoolSize: size})
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

// POST /v1/devices/link-token — an authed device mints a provisioning token so
// another device can join its account. Returns the token + its TTL.
func (h *handlers) linkToken(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.bearerUser(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing or invalid token")
		return
	}
	accountID, ok := h.store.accountIDFor(userID)
	if !ok {
		writeError(w, http.StatusNotFound, "account not found")
		return
	}
	token, ttl := h.store.createLinkToken(accountID)
	writeJSON(w, http.StatusOK, LinkTokenResponse{Token: token, ExpiresInSec: int(ttl.Seconds())})
}

// POST /v1/devices/link — a new device joins an account using a provisioning
// token (the token is the authorization, so this route is not bearer-authed).
func (h *handlers) link(w http.ResponseWriter, r *http.Request) {
	var req LinkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Token == "" || req.IdentityKeyB64 == "" {
		writeError(w, http.StatusBadRequest, "missing token or identity key")
		return
	}
	userID, accountID, token, ok := h.store.linkDevice(req.Token, req.asRegister())
	if !ok {
		writeError(w, http.StatusUnauthorized, "invalid or expired link token")
		return
	}
	writeJSON(w, http.StatusOK, LinkResponse{UserID: userID, AccountID: accountID, Token: token})
}

// GET /v1/accounts/{accountId}/devices — list the device userIDs sharing an
// account, so a sender can fan a message out to all of a peer's devices.
func (h *handlers) devices(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.bearerUser(r); !ok {
		writeError(w, http.StatusUnauthorized, "missing or invalid token")
		return
	}
	accountID := r.PathValue("accountId")
	writeJSON(w, http.StatusOK, DevicesResponse{Devices: h.store.devicesFor(accountID)})
}

// GET /v1/accounts/{userId}/account — resolve a device userID to its accountID,
// so a recipient threads a linked peer's messages under one conversation.
func (h *handlers) account(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.bearerUser(r); !ok {
		writeError(w, http.StatusUnauthorized, "missing or invalid token")
		return
	}
	accountID, ok := h.store.accountIDFor(r.PathValue("userId"))
	if !ok {
		writeError(w, http.StatusNotFound, "no verified account for that user")
		return
	}
	writeJSON(w, http.StatusOK, AccountResponse{AccountID: accountID})
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
