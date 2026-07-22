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

### Native crypto binding

`@signalapp/libsignal-client` (npm) is a Node native module and does not run
under Hermes/JSC. Instead the app uses **`org.signal:libsignal-android`** — the
*same* Signal Rust core with a Java API, versioned to match — through a small
native module:

```
android/.../crypto/HwfaCryptoModule.kt   Kotlin module over libsignal-android
android/.../crypto/HwfaCryptoPackage.kt  registers it (see MainApplication.kt)
src/crypto/NativeHwfaCrypto.ts           typed JS bridge
src/crypto/rnCryptoProvider.ts           adapts it to CryptoProvider
```

Because it's the same core, bundles + ciphertext are byte-for-byte compatible
with the backend and the `@hwfa/client` headless tests (Kyber PQXDH included).

- **Android: implemented.** **iOS: pending** — the equivalent module over
  Signal's official Swift `LibSignalClient`.
- Ratchet state is **in-memory** in the native module for Phase 1 — persist to
  SQLCipher (`react-native-quick-sqlite`) and identity keys to the Android
  Keystore / iOS Keychain (`react-native-keychain`) before release.

> ⚠️ **Licensing:** `libsignal` is **AGPL-3.0**. Shipping it makes this app
> subject to the AGPL. This is a product/legal decision to resolve before
> release — Signal does not generally grant commercial exceptions.

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
