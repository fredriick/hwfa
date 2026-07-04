# mobile — React Native (iOS + Android), Phase 1

**Not yet scaffolded.** This is the flagship client. It will be initialized with
React Native (bare workflow — needed for native modules) and consume the shared
workspace packages:

- `@hwfa/crypto` — libsignal wrappers (already built + tested in Phase 0)
- `@hwfa/models` — envelope / message / scam types (already built)
- `@hwfa/ui` — shared design system (Phase 1)

Native module dependencies to wire in Phase 1 (see spec §Full Stack):
`react-native-quick-sqlite` (+ SQLCipher), `react-native-keychain`,
`onnxruntime-react-native`, `@react-native-firebase`.

> Phase 0 deliberately proved the crypto + relay flow headlessly (see
> `packages/crypto/spike`) before investing in native UI, per the spec's
> guidance: "Until two real devices are exchanging real E2EE messages through
> your relay, all other work is speculative."
