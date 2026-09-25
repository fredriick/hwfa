package main

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"sync"
	"time"

	"hwfa/authtoken"
)

// tokenTTL bounds a leaked bearer token's lifetime. Long enough that a resumed
// session rarely needs re-verification; a refresh flow is a later addition.
const tokenTTL = 30 * 24 * time.Hour

// linkTTL is how long a device-provisioning token stays valid after the primary
// device mints it. Short by design: the code is meant to be used immediately.
const linkTTL = 5 * time.Minute

// OTP hardening: a code expires, survives only a few wrong guesses, and a phone
// can't be spammed with new codes faster than the cooldown. Without these an
// attacker who knows a userID can brute-force the 6-digit code (10^6) to seize
// the account bound to a victim's number.
const (
	otpTTL           = 10 * time.Minute
	maxOTPAttempts   = 5
	registerCooldown = 30 * time.Second
)

// linkToken authorizes one secondary device to join an existing account.
type linkToken struct {
	accountID string
	expiresAt time.Time
}

// pendingOTP is a code awaiting verification, with an expiry and a wrong-guess
// counter so it can't be brute-forced. In-memory only (short-lived; dropping it
// on restart just means the user re-requests a code — safer than persisting).
type pendingOTP struct {
	code      string
	expiresAt time.Time
	attempts  int
}

// account is the server-side record for one registered device. It holds the
// public key material and the one-time prekey pool. Note what is NOT here: the
// raw phone number (only a salted hash) and any private keys — Discovery never
// sees either.
type account struct {
	userID string
	// accountID groups a user's devices: the primary device's accountID is its
	// own userID; a linked secondary device shares the primary's userID here.
	// Peers address a user by the primary userID (what contact discovery returns)
	// and fan a message out to every device sharing that accountID.
	accountID string
	// phoneHashB64 = base64(sha256(salt || phoneNumber)). Used for contact
	// intersection; the raw number is discarded after the OTP is sent. Empty for
	// linked secondary devices, so only the primary is discoverable by number.
	phoneHashB64 string
	deviceID     int
	registrationID int

	identityKeyB64           string
	signedPreKeyID           int
	signedPreKeyPublicB64    string
	signedPreKeySignatureB64 string
	kyberPreKeyID            int
	kyberPreKeyPublicB64     string
	kyberPreKeySignatureB64  string

	oneTime  []OneTimePreKey // FIFO pool; consumed one per fetch
	verified bool
}

// Store is the backing for Phase 1's spike. Production replaces it with Postgres
// (`accounts`, `key_bundles`, `one_time_prekeys`) but the API surface and
// semantics are the real thing. When a path is configured (DISCOVERY_DATA) the
// store persists to a JSON file so registrations — and, critically, the salt —
// survive a restart; otherwise it is purely in-memory.
type Store struct {
	mu       sync.Mutex
	path     string              // persistence file; "" = in-memory only
	salt     []byte
	accounts map[string]*account    // userID -> account (one per device)
	pending  map[string]*pendingOTP // userID -> code awaiting verification (in-memory)
	// secret signs bearer tokens; they're stateless (HMAC), so there is no
	// server-side token store to keep or persist.
	secret []byte
	// lastRegister throttles OTP sends per phone hash (SMS-bomb / cost guard).
	lastRegister map[string]time.Time
	// linkTokens are ephemeral device-provisioning codes (not persisted; they
	// expire in minutes, so losing them on restart is fine).
	linkTokens map[string]linkToken // link token -> {accountID, expiry}
}

// NewStore builds an empty in-memory store with a fresh random salt.
func NewStore() *Store {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		panic("discovery: cannot read random salt: " + err.Error())
	}
	return &Store{
		salt:         salt,
		accounts:     make(map[string]*account),
		pending:      make(map[string]*pendingOTP),
		secret:       authtoken.SecretFromEnv(),
		lastRegister: make(map[string]time.Time),
		linkTokens:   make(map[string]linkToken),
	}
}

// NewPersistentStore loads the store from `path` if the file exists, otherwise
// starts empty and will write to that path on the first mutation. Persisting the
// salt is what makes contact discovery keep working across restarts — a fresh
// salt would break every previously-registered phone hash.
func NewPersistentStore(path string) *Store {
	s := NewStore()
	s.path = path
	if err := s.load(); err != nil {
		log.Printf("discovery: could not load %s (%v); starting empty", path, err)
	} else if len(s.accounts) > 0 {
		log.Printf("discovery: loaded %d account(s) from %s", len(s.accounts), path)
	}
	return s
}

// --- persistence ---

type persistedAccount struct {
	UserID                   string          `json:"userId"`
	AccountID                string          `json:"accountId,omitempty"`
	PhoneHashB64             string          `json:"phoneHashB64"`
	DeviceID                 int             `json:"deviceId"`
	RegistrationID           int             `json:"registrationId"`
	IdentityKeyB64           string          `json:"identityKeyB64"`
	SignedPreKeyID           int             `json:"signedPreKeyId"`
	SignedPreKeyPublicB64    string          `json:"signedPreKeyPublicB64"`
	SignedPreKeySignatureB64 string          `json:"signedPreKeySignatureB64"`
	KyberPreKeyID            int             `json:"kyberPreKeyId"`
	KyberPreKeyPublicB64     string          `json:"kyberPreKeyPublicB64"`
	KyberPreKeySignatureB64  string          `json:"kyberPreKeySignatureB64"`
	OneTime                  []OneTimePreKey `json:"oneTime"`
	Verified                 bool            `json:"verified"`
}

type persistedState struct {
	SaltB64  string             `json:"saltB64"`
	Accounts []persistedAccount `json:"accounts"`
	// Neither pending OTPs (short-lived) nor bearer tokens (stateless, HMAC-signed)
	// are persisted — there is no server-side token store to keep.
}

// persistLocked writes the current state to disk. Caller must hold s.mu. No-op
// when no path is configured. Writes atomically via a temp file + rename.
func (s *Store) persistLocked() {
	if s.path == "" {
		return
	}
	state := persistedState{
		SaltB64:  s.saltB64(),
		Accounts: make([]persistedAccount, 0, len(s.accounts)),
	}
	for _, a := range s.accounts {
		state.Accounts = append(state.Accounts, persistedAccount{
			UserID: a.userID, AccountID: a.accountID, PhoneHashB64: a.phoneHashB64, DeviceID: a.deviceID,
			RegistrationID: a.registrationID, IdentityKeyB64: a.identityKeyB64,
			SignedPreKeyID: a.signedPreKeyID, SignedPreKeyPublicB64: a.signedPreKeyPublicB64,
			SignedPreKeySignatureB64: a.signedPreKeySignatureB64, KyberPreKeyID: a.kyberPreKeyID,
			KyberPreKeyPublicB64: a.kyberPreKeyPublicB64, KyberPreKeySignatureB64: a.kyberPreKeySignatureB64,
			OneTime: a.oneTime, Verified: a.verified,
		})
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		log.Printf("discovery: marshal state failed: %v", err)
		return
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		log.Printf("discovery: write %s failed: %v", tmp, err)
		return
	}
	if err := os.Rename(tmp, s.path); err != nil {
		log.Printf("discovery: rename into %s failed: %v", s.path, err)
	}
}

// load reads the state from disk into the store. A missing file is not an error.
func (s *Store) load() error {
	data, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var state persistedState
	if err := json.Unmarshal(data, &state); err != nil {
		return err
	}
	salt, err := base64.StdEncoding.DecodeString(state.SaltB64)
	if err != nil {
		return err
	}
	s.salt = salt
	for i := range state.Accounts {
		p := state.Accounts[i]
		// Back-compat: records written before multi-device have no accountId; a
		// lone device is its own account.
		accountID := p.AccountID
		if accountID == "" {
			accountID = p.UserID
		}
		s.accounts[p.UserID] = &account{
			userID: p.UserID, accountID: accountID, phoneHashB64: p.PhoneHashB64, deviceID: p.DeviceID,
			registrationID: p.RegistrationID, identityKeyB64: p.IdentityKeyB64,
			signedPreKeyID: p.SignedPreKeyID, signedPreKeyPublicB64: p.SignedPreKeyPublicB64,
			signedPreKeySignatureB64: p.SignedPreKeySignatureB64, kyberPreKeyID: p.KyberPreKeyID,
			kyberPreKeyPublicB64: p.KyberPreKeyPublicB64, kyberPreKeySignatureB64: p.KyberPreKeySignatureB64,
			oneTime: p.OneTime, verified: p.Verified,
		}
	}
	return nil
}

func (s *Store) saltB64() string {
	return base64.StdEncoding.EncodeToString(s.salt)
}

// hashPhone computes the salted phone hash the same way the client does for
// contact discovery, so a freshly registered number matches an intersect query.
func (s *Store) hashPhone(phone string) string {
	h := sha256.New()
	h.Write(s.salt)
	h.Write([]byte(phone))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

// register stores a new unverified account and returns its userID plus the OTP
// the client must echo back to verify. The raw phone is hashed immediately and
// not retained. Returns ok=false (without touching state) when the same number
// requested a code within the cooldown, so a number can't be SMS-bombed.
func (s *Store) register(req RegisterRequest) (userID, otp string, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	phoneHash := s.hashPhone(req.PhoneNumber)
	if last, seen := s.lastRegister[phoneHash]; seen && time.Since(last) < registerCooldown {
		return "", "", false
	}
	s.lastRegister[phoneHash] = time.Now()

	userID = newUUID()
	otp = newOTP()

	s.accounts[userID] = &account{
		userID:                   userID,
		accountID:                userID, // a fresh registration is its own account
		phoneHashB64:             phoneHash,
		deviceID:                 req.DeviceID,
		registrationID:           req.RegistrationID,
		identityKeyB64:           req.IdentityKeyB64,
		signedPreKeyID:           req.SignedPreKeyID,
		signedPreKeyPublicB64:    req.SignedPreKeyPublicB64,
		signedPreKeySignatureB64: req.SignedPreKeySignatureB64,
		kyberPreKeyID:            req.KyberPreKeyID,
		kyberPreKeyPublicB64:     req.KyberPreKeyPublicB64,
		kyberPreKeySignatureB64:  req.KyberPreKeySignatureB64,
		oneTime:                  append([]OneTimePreKey(nil), req.OneTimePreKeys...),
		verified:                 false,
	}
	s.pending[userID] = &pendingOTP{code: otp, expiresAt: time.Now().Add(otpTTL)}
	s.persistLocked()
	return userID, otp, true
}

// verify checks the OTP for an account. On success it marks the account
// verified and issues a bearer token. A code that is expired, or has been
// guessed wrong too many times, is discarded — forcing the client to request a
// fresh one — so the 6-digit space can't be brute-forced.
func (s *Store) verify(userID, code string) (token string, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	p := s.pending[userID]
	if p == nil {
		return "", false
	}
	if time.Now().After(p.expiresAt) {
		delete(s.pending, userID)
		return "", false
	}
	if p.code != code {
		p.attempts++
		if p.attempts >= maxOTPAttempts {
			delete(s.pending, userID) // too many wrong guesses — burn the code
		}
		return "", false
	}
	acct, exists := s.accounts[userID]
	if !exists {
		return "", false
	}
	acct.verified = true
	delete(s.pending, userID)
	s.persistLocked()
	return authtoken.Sign(s.secret, userID, tokenTTL), true
}

// createLinkToken mints a short-lived provisioning token authorizing another
// device to join `accountID`. Called by an already-verified device.
func (s *Store) createLinkToken(accountID string) (token string, ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	token = newToken()
	s.linkTokens[token] = linkToken{accountID: accountID, expiresAt: time.Now().Add(linkTTL)}
	return token, linkTTL
}

// linkDevice consumes a provisioning token and registers a new device under the
// token's account. The device is verified immediately (the token is the
// authorization) and has no phone hash, so only the primary stays discoverable
// by number. Returns the new device's userID, its accountID, and a bearer token.
func (s *Store) linkDevice(token string, req RegisterRequest) (userID, accountID, bearer string, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	lt, exists := s.linkTokens[token]
	if !exists || time.Now().After(lt.expiresAt) {
		delete(s.linkTokens, token) // clean up an expired token
		return "", "", "", false
	}
	// The account being joined must still exist.
	if _, exists := s.accounts[lt.accountID]; !exists {
		return "", "", "", false
	}

	userID = newUUID()
	deviceID := req.DeviceID
	if deviceID == 0 {
		deviceID = 1
	}
	s.accounts[userID] = &account{
		userID:                   userID,
		accountID:                lt.accountID,
		phoneHashB64:             "", // linked devices aren't independently discoverable
		deviceID:                 deviceID,
		registrationID:           req.RegistrationID,
		identityKeyB64:           req.IdentityKeyB64,
		signedPreKeyID:           req.SignedPreKeyID,
		signedPreKeyPublicB64:    req.SignedPreKeyPublicB64,
		signedPreKeySignatureB64: req.SignedPreKeySignatureB64,
		kyberPreKeyID:            req.KyberPreKeyID,
		kyberPreKeyPublicB64:     req.KyberPreKeyPublicB64,
		kyberPreKeySignatureB64:  req.KyberPreKeySignatureB64,
		oneTime:                  append([]OneTimePreKey(nil), req.OneTimePreKeys...),
		verified:                 true,
	}
	delete(s.linkTokens, token) // one-time use
	s.persistLocked()
	return userID, lt.accountID, authtoken.Sign(s.secret, userID, tokenTTL), true
}

// devicesFor returns the userIDs of every verified device sharing an accountID
// (the primary plus any linked devices). A single-device user returns just
// itself, so callers can always fan out over this list.
func (s *Store) devicesFor(accountID string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []string
	for _, a := range s.accounts {
		if a.verified && a.accountID == accountID {
			out = append(out, a.userID)
		}
	}
	return out
}

// accountIDFor resolves a device userID to its accountID (so a recipient can
// thread messages from any of a peer's devices under the one account).
func (s *Store) accountIDFor(userID string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.accounts[userID]
	if !ok || !a.verified {
		return "", false
	}
	return a.accountID, true
}

// userForToken resolves a bearer token to its account userID by verifying its
// signature + expiry (stateless — no server-side token store).
func (s *Store) userForToken(token string) (string, bool) {
	return authtoken.Verify(s.secret, token)
}

// bundleFor returns a peer's published bundle, consuming one one-time prekey
// from the pool (nil one-time fields if the pool is exhausted — X3DH still
// works without it, just without that extra forward-secrecy guarantee). Only
// verified accounts are discoverable.
func (s *Store) bundleFor(userID string) (PublishedKeyBundle, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	acct, ok := s.accounts[userID]
	if !ok || !acct.verified {
		return PublishedKeyBundle{}, false
	}

	bundle := PublishedKeyBundle{
		RegistrationID:           acct.registrationID,
		DeviceID:                 acct.deviceID,
		IdentityKeyB64:           acct.identityKeyB64,
		SignedPreKeyID:           acct.signedPreKeyID,
		SignedPreKeyPublicB64:    acct.signedPreKeyPublicB64,
		SignedPreKeySignatureB64: acct.signedPreKeySignatureB64,
		KyberPreKeyID:            acct.kyberPreKeyID,
		KyberPreKeyPublicB64:     acct.kyberPreKeyPublicB64,
		KyberPreKeySignatureB64:  acct.kyberPreKeySignatureB64,
	}

	if len(acct.oneTime) > 0 {
		otk := acct.oneTime[0]
		acct.oneTime = acct.oneTime[1:] // consume it
		id := otk.ID
		pub := otk.PublicB64
		bundle.OneTimePreKeyID = &id
		bundle.OneTimePreKeyPublicB64 = &pub
		s.persistLocked() // pool shrank — persist so a restart doesn't reissue it
	}
	return bundle, true
}

// poolSize reports how many one-time prekeys an account still has (so the client
// can decide whether to replenish).
func (s *Store) poolSize(userID string) (int, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	acct, ok := s.accounts[userID]
	if !ok {
		return 0, false
	}
	return len(acct.oneTime), true
}

// addOneTime appends prekeys to an account's pool and returns the new size.
func (s *Store) addOneTime(userID string, keys []OneTimePreKey) (int, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	acct, ok := s.accounts[userID]
	if !ok {
		return 0, false
	}
	acct.oneTime = append(acct.oneTime, keys...)
	s.persistLocked()
	return len(acct.oneTime), true
}

// intersect returns, for each submitted hash, the matching verified account (if
// any). The server only ever confirms hashes the client already holds; it never
// enumerates its user base or learns unregistered numbers.
func (s *Store) intersect(hashes []string) []IntersectMatch {
	s.mu.Lock()
	defer s.mu.Unlock()

	byHash := make(map[string]string, len(s.accounts))
	for _, acct := range s.accounts {
		if acct.verified {
			byHash[acct.phoneHashB64] = acct.userID
		}
	}

	matches := make([]IntersectMatch, 0)
	seen := make(map[string]bool)
	for _, h := range hashes {
		if seen[h] {
			continue
		}
		seen[h] = true
		if uid, ok := byHash[h]; ok {
			matches = append(matches, IntersectMatch{PhoneHashB64: h, UserID: uid})
		}
	}
	return matches
}

// --- small helpers (stdlib only, no external UUID/token deps) ---

func newUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("discovery: cannot read random uuid: " + err.Error())
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func newToken() string {
	var b [24]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("discovery: cannot read random token: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}

// newOTP returns a 6-digit numeric code, zero-padded.
func newOTP() string {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("discovery: cannot read random otp: " + err.Error())
	}
	n := (uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3])) % 1000000
	return fmt.Sprintf("%06d", n)
}
