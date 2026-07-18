package main

// Wire types for the Discovery API. The published-key-bundle shape mirrors
// `PublishedKeyBundle` in packages/crypto/src/identity.ts and the
// `key_bundles` / `one_time_prekeys` Postgres tables — keep the three in sync.

// OneTimePreKey is one ephemeral prekey in a device's pool. The server hands
// out one per new session (consuming it) so each inbound X3DH gets a fresh one.
type OneTimePreKey struct {
	ID        int    `json:"id"`
	PublicB64 string `json:"publicB64"`
}

// PublishedKeyBundle is the public half a device uploads and its peers fetch to
// start a session. Field names match the TypeScript `PublishedKeyBundle`.
type PublishedKeyBundle struct {
	RegistrationID           int     `json:"registrationId"`
	DeviceID                 int     `json:"deviceId"`
	IdentityKeyB64           string  `json:"identityKeyB64"`
	SignedPreKeyID           int     `json:"signedPreKeyId"`
	SignedPreKeyPublicB64    string  `json:"signedPreKeyPublicB64"`
	SignedPreKeySignatureB64 string  `json:"signedPreKeySignatureB64"`
	KyberPreKeyID            int     `json:"kyberPreKeyId"`
	KyberPreKeyPublicB64     string  `json:"kyberPreKeyPublicB64"`
	KyberPreKeySignatureB64  string  `json:"kyberPreKeySignatureB64"`
	OneTimePreKeyID          *int    `json:"oneTimePreKeyId"`
	OneTimePreKeyPublicB64   *string `json:"oneTimePreKeyPublicB64"`
}

// RegisterRequest carries the phone number to verify plus the device's full
// published key material (the reusable bundle + the whole one-time prekey pool).
// The raw phone number is used only to send the OTP; the server stores only a
// salted hash of it, never the number itself.
type RegisterRequest struct {
	PhoneNumber              string          `json:"phoneNumber"`
	DeviceID                 int             `json:"deviceId"`
	RegistrationID           int             `json:"registrationId"`
	IdentityKeyB64           string          `json:"identityKeyB64"`
	SignedPreKeyID           int             `json:"signedPreKeyId"`
	SignedPreKeyPublicB64    string          `json:"signedPreKeyPublicB64"`
	SignedPreKeySignatureB64 string          `json:"signedPreKeySignatureB64"`
	KyberPreKeyID            int             `json:"kyberPreKeyId"`
	KyberPreKeyPublicB64     string          `json:"kyberPreKeyPublicB64"`
	KyberPreKeySignatureB64  string          `json:"kyberPreKeySignatureB64"`
	OneTimePreKeys           []OneTimePreKey `json:"oneTimePreKeys"`
}

type RegisterResponse struct {
	UserID  string `json:"userId"`
	OTPSent bool   `json:"otpSent"`
	// DevOTP is populated ONLY when DISCOVERY_DEV=1, so headless tests can
	// complete verification without a real SMS gateway. Never set in production.
	DevOTP string `json:"devOtp,omitempty"`
}

type VerifyRequest struct {
	UserID string `json:"userId"`
	Code   string `json:"code"`
}

type VerifyResponse struct {
	Verified bool   `json:"verified"`
	Token    string `json:"token"`
}

// UploadRequest replenishes a device's one-time prekey pool. Authenticated via
// the bearer token issued at verification; the token identifies the account.
type UploadRequest struct {
	OneTimePreKeys []OneTimePreKey `json:"oneTimePreKeys"`
}

type UploadResponse struct {
	PoolSize int `json:"poolSize"`
}

type SaltResponse struct {
	SaltB64 string `json:"saltB64"`
}

// IntersectRequest is the privacy-preserving contact discovery input: the
// client hashes each of its contacts' phone numbers with the server salt and
// sends the hash set. The server never learns which unregistered numbers were
// queried — only which submitted hashes match a registered account.
//
// The spec lists this route as GET, but a contact set needs a request body, so
// it is served as POST /v1/contacts/intersect.
type IntersectRequest struct {
	PhoneHashesB64 []string `json:"phoneHashesB64"`
}

// IntersectMatch pairs a matched hash back to the registered account, so the
// client can start a chat without a second lookup.
type IntersectMatch struct {
	PhoneHashB64 string `json:"phoneHashB64"`
	UserID       string `json:"userId"`
}

type IntersectResponse struct {
	Matches []IntersectMatch `json:"matches"`
}
