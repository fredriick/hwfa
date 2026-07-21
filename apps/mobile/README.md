# @hwfa/mobile — React Native (Android + iOS), Phase 1

The flagship client. Scaffolded with React Native **0.86** (New Architecture)
and wired to the shared workspace core:

- `@hwfa/client` — the portable client core (Discovery onboarding, relay socket,
  conversation orchestration). Proven headlessly by `npm test -w @hwfa/client`.
- `@hwfa/models` — envelope / message / scam types.

## Architecture

The risky, reusable logic lives in `@hwfa/client` (pure TS, runs anywhere
`fetch` + `WebSocket` exist) so it can be tested without a device. This app is a
thin UI over it:

```
App.tsx                     state-based nav: onboarding → contacts → chat
src/config.ts               relay + discovery URLs (Android emulator → 10.0.2.2)
src/client/hwfaClient.ts    builds the singleton HwfaClient
src/crypto/rnCryptoProvider native Signal-Protocol binding  ← the one TODO
src/screens/*               Onboarding · Contacts · Chat
```

### The one remaining piece: native crypto

`@signalapp/libsignal-client` is a Node native module and does **not** run under
Hermes/JSC. Everything else already works; only `src/crypto/rnCryptoProvider.ts`
needs a real implementation — a React Native native module wrapping
`libsignal-ffi` (JSI/TurboModule) exposing the four `CryptoProvider` methods.
Until then, onboarding surfaces a clear "native binding not implemented" error;
the UI, Discovery, and relay paths are otherwise complete.

Then: persist ratchet state to SQLCipher (`react-native-quick-sqlite`) and
identity keys to the Keychain/Keystore (`react-native-keychain`).

## Prerequisites

- **Node ≥ 22** (RN 0.86 requires it — the rest of the monorepo runs on 20, so
  use nvm to switch when working on mobile).
- Android Studio + an **API 36** emulator (see repo root setup).
- JDK 17 (already configured).

## Run

From the repo root (installs hoist to the workspace root):

```bash
npm install
```

Then, with an emulator booted and the backends running
(`npm run spike:discovery` starts relay + discovery, or run each service):

```bash
npm run start   -w @hwfa/mobile     # Metro bundler
npm run android -w @hwfa/mobile     # build + install on the emulator
```

`npm run typecheck -w @hwfa/mobile` type-checks the app against the workspace
packages.

> The `android/` and `ios/` native projects are generated from the RN template.
> Metro is configured for the monorepo (`metro.config.js` watches the repo root
> and resolves hoisted deps).
