# Hwfa
## Build Summary v0.0.1
> Encrypted P2P Messenger with Global AI Scam Detection
> React Native (iOS + Android) + React (Web) + Go Backend
> Solo Founder Build Plan

---

## What Hwfa Is

A hybrid relay messenger — Signal's privacy model, Telegram's reach, WhatsApp's
simplicity — differentiated by built-in AI scam detection that runs on-device
without breaking end-to-end encryption, covering global fraud patterns across
all markets and languages.

No existing messenger ships this. Signal ships nothing. WhatsApp and Telegram
detect accounts server-side, not messages. Google's Gemini Nano on-device
detection is Android-only and OS-level — not inside a messenger, not on iOS,
not on web. Hwfa is the first messenger with E2EE-safe scam detection baked
in, working equally on iOS, Android, and web.

---

## Competitive Landscape

| App             | Detection method                        | E2EE-safe | On-device | iOS | Web |
|-----------------|-----------------------------------------|-----------|-----------|-----|-----|
| WhatsApp        | Account-level behaviour (server-side)   | ✅        | ❌        | ✅  | ✅  |
| Telegram        | Takedowns + user reports                | ✅        | ❌        | ✅  | ✅  |
| Signal          | None — education only                   | ✅        | N/A       | ✅  | ✅  |
| Google Messages | Gemini Nano (Android-only, OS-level)    | ✅        | ✅        | ❌  | ❌  |
| **Hwfa**       | **On-device classifier, all platforms** | **✅**    | **✅**    | **✅** | **✅** |

---

## Why React Native (Not Flutter, Not Full Native)

Signal, WhatsApp, and Telegram all went fully native (Swift + Kotlin) with
shared C++ cores. That's the gold standard — but it requires a team.

React Native is the correct solo-founder approximation:
- Official libsignal bindings (`@signalapp/libsignal-client`) are production-proven
  in RN. Flutter's FFI approach is a research project by comparison.
- React Native + React (web) share TypeScript business logic, crypto abstractions,
  and UI components in a monorepo — web client comes for near-free later.
- Background handling, Secure Enclave, VoIP push, and WebRTC are all better
  documented for messenger builds in RN than Flutter.
- Migration path to native is clean and incremental (brownfield) — replace
  screens one by one when scale or platform requirements demand it. The Go
  backend, libsignal wrappers, and scam detection pipeline carry forward
  unchanged.

---

## Architecture Overview

```
[RN Client] ──E2EE──► [Relay Service] ──E2EE──► [RN Client]
                             │
                      [Discovery API]
                             │
                      [Push Service]
                             │
                      [Media Store — encrypted blobs]
```

Core principle: backend is ciphertext-only. Plaintext never leaves the device.
All AI scam detection runs after decryption, on the client — the only
architecture that is both privacy-safe and genuinely effective.

---

## Monorepo Structure

```
hwfa/
├── apps/
│   ├── mobile/              ← React Native (iOS + Android)
│   └── web/                 ← React (web client — post-launch)
├── packages/
│   ├── crypto/              ← libsignal wrappers, shared TypeScript
│   ├── models/              ← message types, scam detection types, envelopes
│   └── ui/                  ← shared design system components
└── backend/
    ├── relay/               ← Go — WebSocket message routing
    ├── discovery/           ← Go — user lookup, key directory, groups
    ├── push/                ← Go — APNs/FCM notification triggers
    └── media/               ← Go — signed upload/download URL generation
```

---

## Full Stack

| Layer              | Technology                                  |
|--------------------|---------------------------------------------|
| Mobile             | React Native (TypeScript)                   |
| Web (post-launch)  | React (TypeScript) — shared monorepo        |
| Backend            | Go                                          |
| Database           | Supabase (Postgres)                         |
| Media storage      | Cloudflare R2 (S3-compatible)               |
| Crypto             | @signalapp/libsignal-client                 |
| Local DB (mobile)  | SQLCipher via react-native-quick-sqlite     |
| Key storage        | react-native-keychain (Secure Enclave / Keystore) |
| On-device AI       | ONNX Runtime React Native                   |
| Push               | @react-native-firebase (FCM) + APNs         |
| WebRTC (later)     | react-native-webrtc                         |
| Model delivery CDN | Cloudflare R2 + Workers                     |
| Hosting            | fly.io (Go services)                        |
| Monitoring         | Sentry (RN + Go) + fly.io metrics           |

---

## Encryption Layer

### Protocol: Signal Protocol via @signalapp/libsignal-client

Never implement your own crypto. Use the official libsignal library —
the same one Signal itself uses, with official Node/React Native bindings.

**1:1 messaging — Double Ratchet:**
- X3DH (Extended Triple Diffie-Hellman) for initial key agreement
- Double Ratchet Algorithm for per-message forward secrecy
- Every message encrypted with a fresh key derived from the ratchet chain
- Compromise of one key exposes nothing past or future

**Group messaging — Sender Keys:**
- Each member generates a Sender Key for the group
- Distributed to all other members over existing 1:1 pairwise encrypted channels
- Each group message encrypted once with sender key and broadcast
- Member join/leave triggers sender key rotation + redistribution to remaining
  members via 1:1 channels (O(N) cost — fine for MVP group sizes up to ~200)
- Revisit MLS (RFC 9420) post-launch for large community efficiency

**Multi-device — Linked Device Protocol:**
- Primary device (phone) holds the master identity keypair
- Secondary device (desktop/web) links via QR code scan
- QR triggers provisioning handshake: primary sends secondary an encrypted
  one-time key bundle via relay
- Secondary receives its Device ID and root key material
- Messages encrypted to all linked Device IDs simultaneously
- Message history not retroactively synced — only future messages arrive
  (same as Signal)

**Key storage:**
- Private keys: react-native-keychain → Secure Enclave (iOS) /
  Android Keystore — non-extractable, never transmitted
- Public key bundles: uploaded to Discovery API — what other clients
  fetch to encrypt to you
- Local message DB: SQLCipher encrypted at rest, key derived from
  user PIN/biometric

---

## Mobile Client (React Native)

### Screen Architecture

```
App
├── Onboarding
│   ├── PhoneEntryScreen
│   ├── OTPVerificationScreen
│   └── ProfileSetupScreen
├── Main (tab bar)
│   ├── ChatsListScreen
│   ├── ContactsScreen
│   └── SettingsScreen
├── Chat
│   ├── ConversationScreen (1:1)
│   ├── GroupConversationScreen
│   └── MessageBubble (+ inline scam warning banner)
├── Media
│   ├── MediaViewerScreen
│   └── MediaPickerSheet
├── Group
│   ├── NewGroupScreen
│   ├── GroupInfoScreen
│   └── GroupMembersScreen
└── Security
    ├── LinkedDevicesScreen
    ├── SafetyNumberScreen
    └── ScamReportScreen
```

### Scam Warning — Inline UI (not modal)

```
┌──────────────────────────────────────────────────┐
│ ⚠️  Scam pattern detected                        │
│ This message matches patterns common in          │
│ investment fraud. Do not send money or share     │
│ personal information.                            │
│                          [Learn more]  [✕]       │
├──────────────────────────────────────────────────┤
│  "Dear friend, I have an investment              │
│   opportunity that guarantees 300% returns..."   │
└──────────────────────────────────────────────────┘
```

Renders inline above the message bubble — user sees it in context
without interrupting the conversation flow.

---

## Web Client (React — Post-Launch)

Architecture: web client is a linked device, not an independent account.
Mirrors WhatsApp Web / Telegram Web. Ships post-launch; shared monorepo
means most crypto and model logic is already written.

**Stack:**
- React (TypeScript) — shares `packages/crypto`, `packages/models`,
  `packages/ui` from monorepo
- libsignal compiled to WebAssembly (official WASM build)
- IndexedDB — local encrypted message cache
- Web Crypto API — non-extractable CryptoKey key storage
- WebSocket — persistent relay connection
- Service Worker — background Web Push + offline support

**Web linking flow:**
1. User opens Hwfa Web → browser generates provisional keypair
2. Displays QR code encoding provisional public key + relay endpoint
3. User scans QR in mobile app
4. Mobile sends encrypted provisioning bundle to web client via relay
5. Web client decrypts bundle → receives Device ID and root key material
6. Future messages arrive encrypted to all linked devices simultaneously

---

## Backend Services (Go)

Independent Go binaries, each deployed as a container. Kept separate
from day one — they scale independently.

### Relay Service

Responsibilities:
- Accept authenticated WebSocket connections (short-lived JWT, silent refresh)
- Route encrypted envelopes by recipient User ID + Device ID
- Queue messages for offline recipients (store-and-forward, 30-day TTL)
- Trigger push service for offline recipients
- Never inspect ciphertext — only envelope metadata (to/from/timestamp/size)

```go
type Envelope struct {
    ID              string
    RecipientID     string
    RecipientDevice int
    SenderID        string
    CiphertextBlob  []byte    // relay never decrypts this
    Timestamp       time.Time
    TTL             time.Duration
}
```

### Discovery API

```
POST /v1/accounts/register         register phone, upload initial key bundle
POST /v1/accounts/verify           verify OTP
GET  /v1/keys/{userId}             fetch public key bundle for a user
PUT  /v1/keys/upload               replenish one-time prekey pool
GET  /v1/contacts/intersect        privacy-preserving contact discovery
POST /v1/groups                    create group
PUT  /v1/groups/{groupId}/members  add or remove members
```

**Privacy-preserving contact discovery:**
- Client hashes all contact phone numbers with a server-provided salt
- Sends hashed set to server
- Server intersects against hashed registered users
- Returns only intersection — server never learns which unregistered
  numbers you queried

### Media Service

```
POST /v1/media/upload-url     returns signed R2 upload URL
GET  /v1/media/download-url   returns signed R2 download URL
```

Client encrypts media with a random AES-256 key before upload. That key
travels inside the encrypted message body. Server stores only the
ciphertext blob — cannot decrypt even with direct R2 access.

---

## Database Schema (Supabase/Postgres — Server Side)

```sql
-- Account registry — no plaintext phone numbers ever stored
CREATE TABLE accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash  TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  last_seen   TIMESTAMPTZ
);

-- Public key bundles
CREATE TABLE key_bundles (
  account_id        UUID REFERENCES accounts(id),
  device_id         INT,
  identity_key      TEXT NOT NULL,
  signed_prekey     TEXT NOT NULL,
  signed_prekey_sig TEXT NOT NULL,
  PRIMARY KEY (account_id, device_id)
);

-- One-time prekeys — consumed on first message to a device
CREATE TABLE one_time_prekeys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID REFERENCES accounts(id),
  device_id   INT,
  key_id      INT,
  public_key  TEXT NOT NULL,
  used        BOOLEAN DEFAULT false
);

-- Message queue — offline delivery, ciphertext only
CREATE TABLE message_queue (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id  UUID REFERENCES accounts(id),
  device_id     INT,
  sender_id     UUID REFERENCES accounts(id),
  ciphertext    BYTEA NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  expires_at    TIMESTAMPTZ DEFAULT now() + INTERVAL '30 days'
);

-- Groups — membership only, no message content, no plaintext names
CREATE TABLE groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  UUID REFERENCES accounts(id),
  name_hash   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE group_members (
  group_id    UUID REFERENCES groups(id),
  account_id  UUID REFERENCES accounts(id),
  added_at    TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (group_id, account_id)
);
```

**Client-side SQLite via react-native-quick-sqlite + SQLCipher:**

```
SQLite (SQLCipher encrypted at rest — key from PIN/biometric)
├── conversations    thread list, encrypted last-message preview, unread count
├── messages         full message history per thread
├── contacts         known contacts + cached key bundles
├── groups           group metadata + member list
├── media_cache      local paths to decrypted media (purged on logout)
└── signal_store     libsignal internal state (sessions, prekeys, sender keys)
```

---

## Push Notifications

Push payloads must never contain message content — E2EE is pointless
if cleartext arrives via APNs or FCM.

```json
{
  "data": {
    "type": "new_message",
    "sender_id": "<uuid>",
    "thread_id": "<uuid>"
  }
}
```

Client receives push → wakes app → connects to relay via WebSocket →
fetches and decrypts queued messages → updates local store → constructs
native notification text on-device from decrypted content.

For voice/video calls (Phase 5): use VoIP push (PushKit on iOS) which
wakes the app with higher priority and integrates with CallKit — the
only reliable way to deliver incoming call notifications on iOS.

---

## AI Scam Detection — Global

### Global Scam Categories (Tier 1 Training Targets)

| Category | Common patterns |
|---|---|
| Advance-fee / 419 | Inheritance release, upfront payment for promised reward |
| Investment / crypto fraud | Fake platforms, guaranteed returns, rug pulls, pump-and-dump |
| Romance scams | Long trust-building before financial ask, synthetic personas |
| Job offer scams | Fake remote jobs, upfront equipment fees, task pyramid schemes |
| Impersonation | Fake banks, government agencies, tech support, family emergency |
| Phishing links | Lookalike domains, credential harvesting, fake login portals |
| Lottery / prize fraud | Fee or personal data required to claim winnings |
| OTP / credential solicitation | Social engineering for verification codes, PINs, passwords |
| Deepfake voice/video | AI-generated voice notes or video impersonating known contacts |
| Rental / escrow fraud | Fake property listings, fake buyer protection services |

### Global Training Data Sources

| Source | Coverage | Access |
|---|---|---|
| FTC Consumer Sentinel Network | US fraud complaints, massive volume | Public API |
| Action Fraud (UK) | UK national fraud reports with categories | Public datasets |
| ScamWatch (ACCC, Australia) | Australian fraud reports, labeled | Public |
| FBI IC3 Annual Reports | US internet crime with narrative examples | Public PDFs |
| PhishTank + OpenPhish | Crowdsourced phishing URLs, real-time feed | Free API |
| Kaggle fraud/spam corpora | SMS and email scam datasets, multilingual | Free download |
| Fraud Filter internal dataset | Your existing labeled examples | Internal |

### Tier 1 — On-Device Classifier (Always-On, Zero Network)

- Distilled text classifier — not an LLM, no generative capability
- Target: <10MB model, <50ms inference on mid-range device
- Format: ONNX — single model runs on Android and iOS via
  ONNX Runtime React Native
- Quantized to INT8 for size
- Multilingual rollout:
  - v1 model: English only
  - v2 model: + Spanish, French, Portuguese, Arabic
  - v3 model: Multilingual base (multilingual MiniLM) with code-switching support

**Inference flow:**
```
Message received
  → Decrypted via libsignal (on device, in memory)
  → Text extracted
  → Run through Tier 1 ONNX classifier
  → Score ≥ threshold?
      Yes → render inline scam warning banner with matched category
      No  → render normal message bubble
  → User marks false positive?
      → logged locally, batched upload to retraining pipeline
```

**Model update delivery — bypasses app store review cycles:**
- Updated `.onnx` bundles shipped via Cloudflare R2 + Workers
- Client checks model version on launch, downloads silently in background
- Bundle signed with app key — device verifies signature before loading
- New scam patterns roll out in hours, not weeks

### Tier 2 — Cloud Deep-Scan (Explicit Opt-In Per Message)

- User taps "Analyze further" on a Tier 1-flagged message
- Explicit consent dialog before any data leaves device:
  "This message text will be sent to Hwfa's servers for deeper
   analysis. It will not be stored after analysis."
- If confirmed: message text → Fraud Filter backend →
  Gemini 2.5 Flash-Lite analysis → detailed verdict returned
- Natural monetization lever: N free scans/month on free tier,
  unlimited on Hwfa Plus

---

## Native Migration Path (When You Need It)

React Native is the right foundation now. Migration to native is
incremental, not a rewrite:

```
Now (launch):     100% React Native
                       │
After scale:      Replace highest-friction screens with native
                  (calls, camera, notifications first)
                       │
If/when needed:   Fully native iOS (Swift) + Android (Kotlin)
```

What never changes regardless of migration:
- Go backend — relay, discovery, push, media
- libsignal crypto wrappers (packages/crypto)
- Supabase schema
- ONNX scam detection model and training pipeline
- Fraud Filter Tier 2 integration

Migration triggers to watch for (don't migrate early):
- Voice/video calls feel unreliable — native WebRTC/CallKit
- iOS background delivery is dropping messages consistently
- JS thread becomes a measurable bottleneck at scale
- You have a team to maintain two mobile codebases

At 10,000 users, React Native will not be your bottleneck.

---

## Monetization

| Tier | Price | Includes |
|---|---|---|
| Free | $0 | Full E2EE messaging, unlimited Tier 1 on-device scam detection, 5 Tier 2 deep-scans/month, 100MB media/month |
| Hwfa Plus | ~$1–2/mo | Unlimited Tier 2 deep-scans, 2GB media/month, larger file transfers |
| Hwfa Business | ~$3–5/mo | Verified business badge, team workspace, Fraud Filter API access, priority support |

---

## Phase-by-Phase Build Plan

### Phase 0 — Spike (Weeks 1–3)
Goal: de-risk the two hardest technical unknowns before writing any UI.

- [ ] Init monorepo (Turborepo or Nx) with apps/mobile, apps/web, packages/
- [ ] Install @signalapp/libsignal-client in packages/crypto
- [ ] Write unit tests for X3DH handshake and double ratchet encrypt/decrypt
- [ ] Build minimal Go relay: accept two WebSocket connections, route one message
- [ ] Prove full crypto flow: RN instance A → relay → RN instance B, decrypted
- [ ] ONNX Runtime RN prototype: load dummy model, run inference, confirm pipeline

Exit gate: Two React Native instances on two physical devices exchanging
a real E2EE encrypted message through your Go relay. Nothing else matters
until this works.

---

### Phase 1 — Core 1:1 Messaging (Weeks 4–11)

- [ ] Phone number registration + OTP
      (Supabase Auth + Termii or Africa's Talking for SMS delivery)
- [ ] Key bundle upload/fetch via Discovery API
- [ ] 1:1 E2EE chat UI (send, receive, message bubbles, timestamps)
- [ ] Message persistence — SQLCipher via react-native-quick-sqlite
- [ ] Image / video / file sharing
      (client-side AES-256 encrypt → R2 upload → key in E2EE message body)
- [ ] Multi-device linking — QR code provisioning flow
- [ ] Push notifications — FCM + APNs, content-free payloads only
- [ ] Read receipts, delivery receipts, typing indicators
- [ ] Contact discovery — privacy-preserving hash intersection

---

### Phase 2 — On-Device Scam Detection (Weeks 12–17)

- [ ] Compile global training dataset
      (FTC + Action Fraud + ScamWatch + Kaggle + Fraud Filter internal)
- [ ] Train and distill Tier 1 English classifier
      (Python/PyTorch → ONNX export → INT8 quantization)
- [ ] Integrate ONNX Runtime React Native — inference on every decrypted message
- [ ] Inline scam warning banner UI with matched category label
- [ ] False-positive reporting flow (dismiss + report → batched local log → upload)
- [ ] Model update delivery pipeline
      (signed ONNX bundle on R2 + version check on app launch)
- [ ] Conservative threshold at launch — tune upward with feedback data

---

### Phase 3 — Group Chat (Weeks 18–25)

- [ ] Group creation, naming, avatar (metadata encrypted client-side)
- [ ] Sender Key generation and distribution via 1:1 channels
- [ ] Group message encrypt-once, broadcast flow
- [ ] Member add/remove with sender key rotation
- [ ] Group admin controls — invite links, member permissions
- [ ] Group push notification routing
- [ ] Scam detection runs identically on group messages

---

### Phase 4 — Tier 2 + Beta Prep (Weeks 26–29)

- [ ] Opt-in cloud deep-scan UI — explicit per-message consent dialog
- [ ] Fraud Filter backend integration (Gemini 2.5 Flash-Lite)
- [ ] Monthly usage quota system (free tier gating)
- [ ] Safety number / key verification UI
- [ ] Account deletion — key bundle purge + message queue purge + media purge
- [ ] GDPR / NDPR compliance review — engage Lagos tech lawyer before public launch
- [ ] Full onboarding flow polish
- [ ] Closed beta — first cohort from existing network

---

### Phase 5 — Web Client + Multilingual AI (Weeks 30+)

- [ ] React web client (apps/web) — linked device, libsignal WASM
- [ ] Tier 1 v2 model: + Spanish, French, Portuguese, Arabic
- [ ] Tier 1 v3: multilingual MiniLM with code-switching support
- [ ] Voice / video calls (react-native-webrtc + VoIP push on iOS)
- [ ] Status / stories
- [ ] Channels (broadcast-only, Telegram-style)
- [ ] MLS (RFC 9420) migration for large group key efficiency
- [ ] Hwfa Business tier launch

---

## Security Checklist (Non-Negotiable Before Beta)

- [ ] Private keys generated on-device, stored in Secure Enclave / Keystore only
- [ ] react-native-keychain configured with highest security level on both platforms
- [ ] Certificate pinning on all relay and API HTTPS connections
- [ ] SQLCipher encryption verified — confirm DB is not readable without key
- [ ] Push payloads audited — confirm zero message content in any payload
- [ ] Server stores only hashed phone numbers — verify no plaintext in DB
- [ ] Media encryption verified — confirm R2 objects are not readable without key
- [ ] One-time prekey pool automated replenishment — alert at 20 prekeys remaining
- [ ] Safety number UI shipped — users can verify identity out-of-band
- [ ] Account deletion tested end-to-end — all server-side data purged
- [ ] ONNX model bundle signature verification before load confirmed

---

## Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| libsignal RN bindings break on a platform update | Pin the libsignal version; write integration tests that run on CI for both platforms |
| iOS background delivery drops messages | Use silent push + background fetch; VoIP push for calls; well-documented in RN community |
| Multi-device key sync bugs | Exhaustive provisioning handshake tests — most common source of missing-message bugs |
| Network effects — contacts not on Hwfa | Launch with a niche cohort, not general public. 500 real users > 50,000 inactive ones |
| False positives erode AI trust | Conservative threshold at launch. Tighten with false-positive feedback over time |
| Prekey pool exhaustion | Automate replenishment. Monitor pool depth per device. Hard alert at 20 remaining |
| Regulatory (GDPR, NDPR) | No plaintext user content on servers. Hashed phone numbers only. Legal review before launch |
| Scaling the relay under high concurrency | Go handles this well — WebSocket connection pooling is a strength. Benchmark early |

---

## Your First Week

| Day   | Task |
|-------|------|
| 1     | Init monorepo, create apps/mobile (RN), backend/relay (Go), packages/crypto |
| 2     | Install @signalapp/libsignal-client, write first X3DH key agreement unit test |
| 3–4   | Bare Go relay — two WebSocket connections, route one encrypted envelope |
| 5–7   | Full flow on two physical devices: key agreement → encrypt → relay → decrypt |

Everything else — UI, groups, AI, web — builds on that foundation.
Until two real devices are exchanging real E2EE messages through your
relay, all other work is speculative.

---

*Hwfa v0.0.1 — last updated July 2026*
