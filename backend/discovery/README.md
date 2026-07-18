# discovery — Go service (Phase 1)

The "phone book": clients register a phone number (verified by OTP) and upload
their **public** key material; peers fetch that material to start an E2EE
session. Discovery handles no plaintext and no private keys. Phone numbers are
stored only as **salted hashes**, and contact discovery is a hash intersection,
so the server never learns which unregistered numbers a client queried.

## Status: implemented ✅ (in-memory, Phase 1 spike)

Proven by the **discovery handshake** integration spike
(`packages/crypto/spike/discovery-handshake.ts`, run with `npm run
spike:discovery`): two clients register + verify, one fetches the other's bundle
**over the wire**, establishes a real X3DH session from it, and exchanges E2EE
messages through the relay — plus salted-hash contact discovery. This is the
missing half of the Phase 0 gate, where the bundle was handed over in-process.

## Endpoints

```
POST /v1/accounts/register    register phone (hashed) + upload public key bundle + prekey pool → { userId, otpSent }
POST /v1/accounts/verify      verify OTP, issue a bearer token                                 → { verified, token }
GET  /v1/keys/{userId}        fetch a peer's bundle, consuming one one-time prekey  [auth]
PUT  /v1/keys/upload          replenish the caller's own one-time prekey pool       [auth]
GET  /v1/contacts/salt        salt clients use to hash contacts before intersect    [auth]
POST /v1/contacts/intersect   privacy-preserving contact discovery (hash set)       [auth]
```

`[auth]` routes require `Authorization: Bearer <token>` from `/verify`.

**Contact discovery** uses `POST` (the spec lists it as `GET`, but the hash set
needs a request body). The client fetches the salt, hashes each contact's phone
as `base64(sha256(salt || phone))`, and sends the set; the server returns only
the submitted hashes that match a registered account — never enumerating its
user base or learning unregistered numbers.

The bundle it serves is exactly the `PublishedKeyBundle` shape in
`packages/crypto/src/identity.ts`.

## Run

```bash
go build -o discovery.exe .
DISCOVERY_ADDR=:8091 DISCOVERY_DEV=1 ./discovery.exe
```

`DISCOVERY_DEV=1` echoes the OTP in the register response so headless tests can
verify without an SMS gateway — **never set in production** (there the OTP goes
only to the SMS provider: Termii / Africa's Talking per the spec).

## Phase 1 → production gaps (deliberately deferred)

- In-memory store → Postgres (`accounts` / `key_bundles` / `one_time_prekeys`)
- Opaque bearer tokens → short-lived JWTs (Supabase Auth)
- Stubbed SMS → real OTP delivery
- Groups: `POST /v1/groups`, `PUT /v1/groups/{groupId}/members` (not yet built)
- Rate limiting on prekey fetch (prevents one-time-prekey pool exhaustion)
