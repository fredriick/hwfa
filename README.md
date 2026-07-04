# Hwfa

> Encrypted P2P messenger with global on-device AI scam detection.
> Signal's privacy model · Telegram's reach · WhatsApp's simplicity.

See [`hwfa_v0.0.1.md`](./hwfa_v0.0.1.md) for the full product + build spec.

---

## Status: Phase 0 complete ✅

The spec's **Phase 0 exit gate** is met:

> "Two instances exchanging a real E2EE encrypted message through your Go relay.
> Nothing else matters until this works."

Proven here headlessly — two independent [libsignal](https://github.com/signalapp/libsignal)
clients exchange real Signal-Protocol ciphertext through the actual Go relay
over WebSocket, in both directions and through offline store-and-forward, with
the relay only ever seeing opaque envelopes.

### What's built

| Area | Package | State |
|------|---------|-------|
| Shared types (envelope, message, scam) | `packages/models` | ✅ done |
| Crypto core — X3DH/PQXDH + Double Ratchet | `packages/crypto` | ✅ done, 5 unit tests pass |
| Go WebSocket relay (routing + store-and-forward) | `backend/relay` | ✅ done |
| E2EE-through-relay integration spike | `packages/crypto/spike` | ✅ exit gate passes |
| Discovery / Push / Media services | `backend/*` | 🔲 Phase 1 (stubbed) |
| Mobile / Web apps, UI kit | `apps/*`, `packages/ui` | 🔲 Phase 1+ (stubbed) |

---

## Repo layout

```
hwfa/
├── apps/
│   ├── mobile/     ← React Native (Phase 1)
│   └── web/        ← React web, linked device (Phase 5)
├── packages/
│   ├── crypto/     ← libsignal wrappers — X3DH + Double Ratchet ✅
│   ├── models/     ← envelope / message / scam types ✅
│   └── ui/         ← shared design system (Phase 1)
└── backend/
    ├── relay/      ← Go WebSocket message routing ✅
    ├── discovery/  ← Go user lookup + key directory (Phase 1)
    ├── push/       ← Go APNs/FCM triggers (Phase 1)
    └── media/      ← Go signed R2 URLs (Phase 1)
```

---

## Prerequisites

- Node.js ≥ 20 (built on 24)
- Go ≥ 1.24
- npm workspaces (bundled with npm)

## Getting started

```bash
npm install            # installs workspace deps incl. libsignal (native module)
```

> If `npm install` fails with `ERR_SSL_CIPHER_OPERATION_FAILED`, that's an
> intermittent TLS drop on a large tarball — re-run with `npm install
> --prefer-offline` (the cached tarball avoids the flaky fetch).

### Run the crypto unit tests (X3DH + Double Ratchet)

```bash
npm test -w @hwfa/crypto
```

### Run the Phase 0 exit gate (E2EE through the real Go relay)

```bash
npm run spike
```

This builds and launches `backend/relay`, spins up two libsignal clients, and
asserts a real encrypted message survives the round trip client → relay →
client, plus the offline store-and-forward path.

### Build / run the relay standalone

```bash
cd backend/relay
go build -o relay.exe .
RELAY_ADDR=:8080 ./relay.exe      # then connect ws://localhost:8080/v1/relay?userId=<id>&deviceId=<n>
```

---

## Architecture invariant

The backend is **ciphertext-only**. Plaintext never leaves the device. All AI
scam detection runs after decryption, on the client — the only architecture that
is both privacy-safe and effective. The relay routes by envelope metadata
(to / from / timestamp / size) and never decrypts.

## Next: Phase 1 — Core 1:1 messaging

Phone registration + OTP, the Discovery API (key bundle upload/fetch), the 1:1
chat UI in `apps/mobile`, SQLCipher message persistence, media sharing, and
push. See the spec's Phase 1 checklist.
