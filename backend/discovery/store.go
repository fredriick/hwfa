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
)

// account is the server-side record for one registered device. It holds the
// public key material and the one-time prekey pool. Note what is NOT here: the
// raw phone number (only a salted hash) and any private keys — Discovery never
// sees either.
type account struct {
	userID string
	// phoneHashB64 = base64(sha256(salt || phoneNumber)). Used for contact
	// intersection; the raw number is discarded after the OTP is sent.
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
	accounts map[string]*account // userID -> account
	pending  map[string]string   // userID -> OTP code awaiting verification
	tokens   map[string]string   // bearer token -> userID
}

// NewStore builds an empty in-memory store with a fresh random salt.
func NewStore() *Store {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		panic("discovery: cannot read random salt: " + err.Error())
	}
	return &Store{
		salt:     salt,
		accounts: make(map[string]*account),
		pending:  make(map[string]string),
		tokens:   make(map[string]string),
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
	Pending  map[string]string  `json:"pending"`
	Tokens   map[string]string  `json:"tokens"`
}

// persistLocked writes the current state to disk. Caller must hold s.mu. No-op
// when no path is configured. Writes atomically via a temp file + rename.
func (s *Store) persistLocked() {
	if s.path == "" {
		return
	}
	state := persistedState{
		SaltB64:  s.saltB64(),
		Pending:  s.pending,
		Tokens:   s.tokens,
		Accounts: make([]persistedAccount, 0, len(s.accounts)),
	}
	for _, a := range s.accounts {
		state.Accounts = append(state.Accounts, persistedAccount{
			UserID: a.userID, PhoneHashB64: a.phoneHashB64, DeviceID: a.deviceID,
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
	if state.Pending != nil {
		s.pending = state.Pending
	}
	if state.Tokens != nil {
		s.tokens = state.Tokens
	}
	for i := range state.Accounts {
		p := state.Accounts[i]
		s.accounts[p.UserID] = &account{
			userID: p.UserID, phoneHashB64: p.PhoneHashB64, deviceID: p.DeviceID,
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
// not retained.
func (s *Store) register(req RegisterRequest) (userID, otp string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	userID = newUUID()
	otp = newOTP()

	s.accounts[userID] = &account{
		userID:                   userID,
		phoneHashB64:             s.hashPhone(req.PhoneNumber),
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
	s.pending[userID] = otp
	s.persistLocked()
	return userID, otp
}

// verify checks the OTP for an account. On success it marks the account
// verified and issues a bearer token bound to the userID.
func (s *Store) verify(userID, code string) (token string, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	want, pending := s.pending[userID]
	if !pending || want != code {
		return "", false
	}
	acct, exists := s.accounts[userID]
	if !exists {
		return "", false
	}
	acct.verified = true
	delete(s.pending, userID)

	token = newToken()
	s.tokens[token] = userID
	s.persistLocked()
	return token, true
}

// userForToken resolves a bearer token to its account userID.
func (s *Store) userForToken(token string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	userID, ok := s.tokens[token]
	return userID, ok
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
