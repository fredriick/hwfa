/**
 * @hwfa/client/node — the Node/libsignal crypto provider.
 *
 * Import this only from Node contexts (tests, the web relay-linked device, CLI
 * tools). React Native must NOT import this subpath — it would try to load the
 * `@signalapp/libsignal-client` native module, which has no RN binding.
 */
export { NodeCryptoProvider } from "./provider.js";
