# Two-account E2EE demo

A terminal "peer" that is a second, fully real account. It onboards through the
same `@hwfa/client` API the React Native app uses, mints Signal keys with the
Node/libsignal `CryptoProvider`, and talks to the same relay + Discovery. You can
chat **emulator app ↔ terminal**, or **terminal ↔ terminal** with two peers.
Every message is end-to-end encrypted (X3DH/PQXDH on first contact, Double
Ratchet after); the relay only ever sees ciphertext.

All commands run from the repo root. Node ≥ 22 required.

## 1. Start the backend

Relay on `:8190`, Discovery on `:8091` — the ports the app expects
(`apps/mobile/src/config.ts`; the Android emulator reaches the host at
`10.0.2.2`). The relay uses 8190 rather than 8090 because a Wondershare
"NativePush" helper respawns onto IPv4 8090 on some machines and steals the
socket.

```
npm run demo:backend -w @hwfa/client
```

Leave it running (Ctrl-C stops both). If it exits immediately with
`bind: Only one usage of each socket address`, a backend is **already** running
on those ports — just reuse it and skip this step.

> `demo:backend` sets `DISCOVERY_DEV=1` (accept-any-OTP onboarding). Local demo
> only — never in production.

## 2a. Emulator app ↔ terminal

1. Boot the emulator and run the app: `npm run android` in `apps/mobile`.
2. Onboard in the app with some phone number, e.g. `+2348030000002`.
3. In another terminal, start a peer with a **different** number:
   ```
   npm run demo:peer -w @hwfa/client -- +2348030000001
   ```
4. In the peer prompt, find the app's number and send:
   ```
   /find +2348030000002
   hello from the terminal
   ```
5. In the app, discover `+2348030000001` and reply. Messages flow both ways,
   encrypted end-to-end.

## 2b. Terminal ↔ terminal (no device)

Two peers in two terminals:

```
# terminal A
npm run demo:peer -w @hwfa/client -- +2348030000001

# terminal B
npm run demo:peer -w @hwfa/client -- +2348030000002
```

In A: `/find +2348030000002` then type a message. In B it appears and B can
reply (B's active peer is set automatically on the first inbound message).

## Peer commands

| Command            | Effect                                                    |
| ------------------ | --------------------------------------------------------- |
| `/find <phone>`    | Look up a contact by phone; make them the active peer     |
| `/to <accountId>`  | Set the active peer directly by account id                |
| `/who`             | Show my id and the active peer                            |
| `/quit`            | Exit                                                      |
| *(anything else)*  | Encrypt and send to the active peer                       |

## Notes

- Each peer keeps its Signal state **in memory** (like the app in Phase 1);
  restarting a peer mints fresh keys and re-onboards as a new account.
- Custom endpoints: `npm run demo:peer -w @hwfa/client -- <phone> <discoveryUrl> <relayUrl>`.
