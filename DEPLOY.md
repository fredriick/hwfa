# Hwfa — Deployment & Security Checklist

Authoritative list of what a production deployment of Hwfa requires, the
fail-safe guards that enforce it, and the security posture (done vs. outstanding)
as of the Phase-1 work. Read this before standing up any non-dev environment.

Services: **discovery** (user directory + key bundles), **relay** (WebSocket
message routing, store-and-forward), **media** (presigned R2 URLs). All three
handle ciphertext and public keys only — never plaintext or private keys.

---

## 1. Production environment variables

Set `HWFA_ENV=production` on **every** service. This flips dev conveniences into
hard startup failures (see §2).

### Shared (all three services)
| Var | Required in prod | Notes |
|---|---|---|
| `HWFA_ENV` | yes → `production` | Enables the fail-safe guards. |
| `HWFA_TOKEN_SECRET` | **yes** | Shared HMAC secret for bearer tokens. Use ≥32 bytes of randomness. **Must be identical across all three services** or tokens won't verify cross-service. Rotating it invalidates every live session (no refresh flow yet — clients re-verify). |

### discovery
| Var | Notes |
|---|---|
| `DISCOVERY_ADDR` | Listen address, e.g. `:8091`. |
| `DISCOVERY_DATA` | JSON persistence path (Phase-1 store; Postgres is the planned replacement). Persists accounts + the contact-discovery salt across restarts. |
| `TEXTBEE_API_KEY` + `TEXTBEE_DEVICE_ID` | SMS OTP delivery via TextBee. Without both, OTPs are only logged (dev). |
| `DISCOVERY_DEV` | **Must NOT be set in prod** — it echoes/accepts OTPs. Startup aborts if set with `HWFA_ENV=production`. |

### relay
| Var | Notes |
|---|---|
| `RELAY_ADDR` | Listen address, e.g. `:8190` (dev uses 8190, not 8090). |
| `RELAY_DATA` | Offline message-queue persistence path (ciphertext only). |
| `FCM_SERVICE_ACCOUNT_JSON` | Path to the Firebase service-account key for content-free push. **Server-side only — never bundle in the app/APK.** Unset = push disabled. |
| `HWFA_ALLOWED_ORIGINS` | Comma-separated browser origins allowed to open a relay WebSocket in prod (e.g. the web client). Native mobile clients send no `Origin` and are always allowed. In dev, all origins are allowed. |

### media
| Var | Notes |
|---|---|
| `MEDIA_ADDR` | Listen address, e.g. `:8092`. |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Cloudflare R2 credentials. Without a bucket + key + secret (and a host) the presign endpoints return 503. Keys are **server-side only**. |
| `MEDIA_S3_ENDPOINT` | Optional. Points presigned URLs at any S3-compatible store (`http(s)://host[:port]`) instead of R2 — e.g. MinIO, or a local dev store. **Use `https` in production; `http` is dev-only.** When set, `R2_ACCOUNT_ID` is unneeded (bucket + key + secret still required). |

---

## 2. Fail-safe guards (enforced in code)

With `HWFA_ENV=production`:
- **Missing `HWFA_TOKEN_SECRET` → the service refuses to start** (no insecure dev-secret fallback). `backend/authtoken`.
- **`DISCOVERY_DEV=1` → discovery refuses to start.** No accept-any/echoed OTP in prod.
- **Relay origin policy tightens:** browser `Origin`s must be in `HWFA_ALLOWED_ORIGINS`; unknown origins are rejected at the WebSocket upgrade.

With `HWFA_ENV` unset (dev/test), all of the above fall back to permissive
behaviour so demos and headless tests run with zero config.

---

## 3. Auth & token model
- Compact HMAC-SHA256 tokens (`{uid, kind, exp}`), signed by discovery and
  verified locally (stateless) by relay and media. Relay identity comes from the
  token, never a client-supplied id.
- **Two kinds:** a short-lived **access** token (15 min) authorizes API/relay/
  media calls; a long-lived **refresh** token (30 days) buys new access tokens
  at `POST /v1/auth/refresh`. The client refreshes transparently (on a 401 or an
  expiring access token). Both are persisted in the Keystore-encrypted store and
  restored on resume.
- **Revocation:** `refresh` succeeds only while the account/device still exists,
  so revoking a linked device or deleting an account stops new access within the
  access TTL (≤15 min) — no server-side token store needed. The relay also
  **closes each socket when its access token expires**, so a revoked device's
  live session can't outlive the token either (it can't refresh to reconnect);
  legit clients refresh + reconnect automatically.

## 4. TLS & networking
- Terminate TLS at a reverse proxy in front of all three services; clients must
  use `https`/`wss` in production (set the mobile `DEV_HOST`/prod config, and
  `HWFA_ALLOWED_ORIGINS` for any web client).
- **Certificate pinning (review #6) is not yet implemented** — add it on the
  mobile prod build once the TLS endpoints are fixed.

## 5. Secrets
- Never commit secrets. `.env.local`, `secrets/`, `google-services.json`, and
  `*adminsdk*.json` are gitignored.
- The FCM service-account key and R2 keys live server-side only, never in the app.

## 6. Data retention & privacy
- Server stores **only** ciphertext and **salted** phone hashes — no plaintext
  numbers or message content anywhere.
- **Account deletion** (`DELETE /v1/accounts`) purges the account's devices, key
  bundles, and directory entry; the client also wipes local state.
- **Relay queue retention:** undelivered ciphertext ages out via a built-in
  **30-day TTL**, and each recipient's queue is **capped** (memory-exhaustion
  guard) — pruned on enqueue, on flush, and on load.
- **R2 media objects** are opaque-keyed/E2EE and not purged per-account —
  configure an **object-expiry lifecycle rule** on the `hwfa-media` bucket.
- **TODO:** set the CORS policy on the `hwfa-media` R2 bucket for the web client.

---

## 7. Security checklist status (from the spec's non-negotiables)

| Item | Status |
|---|---|
| Private keys on-device in Keystore | ✅ EncryptedSharedPreferences, master key in Android Keystore |
| Highest keychain security level (StrongBox / biometric) | ⏳ **#5 pending** — software-backed today; add StrongBox + `setUserAuthenticationRequired` |
| Certificate pinning | ⏳ **#6 pending** — needs prod TLS endpoints (see §4) |
| Message store encrypted at rest | ✅ Keystore-encrypted (SQLCipher was the spec's suggestion; equivalent intent met) |
| Push payloads content-free | ✅ data-only `{type:"wake"}` |
| Server stores only hashed phone numbers | ✅ salted `sha256(salt‖phone)`; raw discarded |
| Media encryption (R2 unreadable without key) | ✅ client-side AES-256-GCM; R2 holds ciphertext |
| One-time prekey auto-replenishment (alert at 20) | ✅ refill floor 20 / target 50 on connect |
| Safety-number UI (out-of-band verify) | ✅ shipped (🛡 in the 1:1 chat header) |
| Account deletion end-to-end | ✅ server purge + local wipe; relay queue has a 30-day TTL, R2 lifecycle pending (§6) |
| OTP brute-force protection | ✅ expiry + attempt cap + register cooldown |
| Relay & media authentication | ✅ signed bearer tokens (§3) |
| Contact-discovery enumeration | 🟡 **#4 partial** — `intersect` now caps batch size and enforces a per-account hourly hash budget (interim anti-enumeration); the full fix is still a PSI/enclave design (Phase-2+) |
| ONNX model bundle signature verification | ⏳ Phase 2 (classifier not yet integrated) |

---

## 8. Outstanding blockers (decisions/hardware, not code)
- ~~**libsignal is AGPL-3.0**~~ **RESOLVED** — the project is licensed
  **AGPL-3.0-or-later** (`LICENSE` at repo root), so the libsignal-linked client
  is distributable. Running a modified service over a network triggers AGPL §13
  (offer source to users). No commercial-exception path exists from Signal; this
  was the right call for an auditable E2EE client.
- **On-device verification** — **largely done** (Android emulator, 2026-10-12).
  Verified on-device against the live Go services: onboarding (register → OTP →
  verify → native libsignal key-bundle → tokens → relay), contact discovery,
  bidirectional 1:1 E2EE text, typing indicators, delivery/read receipts, offline
  store-and-forward, push-token registration, multi-device link + send-side
  fanout + revoke, safety-number verification, group creation + messaging,
  voice-call signaling (SDP offer + ICE + hangup over the E2EE path), on-device
  scam detection (correct category + inline warning), and account deletion
  (server purge + local wipe). A real-hardware emulator bug was found and fixed
  in the process (safety numbers on receive-first conversations, commit 21fc071).
  **Media** upload/download is now proven headlessly end-to-end (client AES-256-GCM
  encrypt → token-gated presigned PUT → store → presigned GET → decrypt + sha256
  verify) against a local S3-compatible store via `MEDIA_S3_ENDPOINT` (§1); the
  store only ever holds ciphertext. **Real SMS OTP delivery is now verified
  end-to-end, handset receipt included** (2026-10-18): with `TEXTBEE_API_KEY` +
  `TEXTBEE_DEVICE_ID` set (in the gitignored `backend/discovery/.env.local`), a
  live `register` routed the OTP through the TextBee Android gateway (`POST
  /api/v1/gateway/send-sms` → HTTP 200, `success:true`, "added to queue"); the
  registered gateway device accepted it, incremented its `sentSMSCount`, and the
  verification code was **received on the recipient handset with a matching code**.
  Debugging note from the bring-up: a healthy gateway can report success at every
  layer yet deliver nothing if its **SIM is out of SMS credit** — the tell was a
  manual SMS composed on the gateway phone *also* failing; topping up the SIM fixed
  it. Also, the production gateway phone should be a **dedicated sender** whose
  number differs from any user's (a phone texting its own SIM is an unreliable
  edge case).
  **Still unverified — each gated on an external, not code:** a *fully connected*
  call (needs a second WebRTC endpoint), and media on a real device through the
  image-picker UI + native cipher (needs R2 or another S3 endpoint — §1). To
  re-run the emulator pass: build the APK with the emulator
  off, boot with a hardware GPU (`-gpu host`), run `npm run demo:backend`, and
  drive a second party with a headless `@hwfa/client` peer (Node crypto provider).
