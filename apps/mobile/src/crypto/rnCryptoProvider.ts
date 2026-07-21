/**
 * React Native CryptoProvider — the native Signal-Protocol binding.
 *
 * STATUS: placeholder. `@signalapp/libsignal-client` is a Node N-API native
 * module and does NOT run under Hermes/JSC in React Native. Signal's own apps
 * bridge libsignal's Rust core (`libsignal-ffi`) through a native module. The
 * production path here is one of:
 *
 *   1. A React Native native module wrapping `libsignal-ffi` (JSI/TurboModule),
 *      exposing the same 4 methods this interface needs, or
 *   2. `react-native-libsignal-client` if/when a maintained binding exists.
 *
 * The portable client core (`@hwfa/client`) is deliberately decoupled from this:
 * everything else — Discovery onboarding, the relay socket, conversation
 * orchestration — already works (see `packages/client` tests). Only these four
 * methods remain to be backed by real on-device crypto. Ratchet state must then
 * persist to SQLCipher (react-native-quick-sqlite) and identity keys to the
 * Keychain/Keystore (react-native-keychain).
 */
import type {
  CryptoProvider,
  EncryptedMessage,
  GenerateRegistrationOptions,
  LocalRegistration,
  PublishedKeyBundle,
} from "@hwfa/client";

const NOT_WIRED =
  "Native libsignal binding not yet implemented. See apps/mobile/src/crypto/rnCryptoProvider.ts — " +
  "the client core is ready; this is the remaining on-device crypto work (Phase 1).";

export class RNCryptoProvider implements CryptoProvider {
  async generateRegistration(
    _opts?: GenerateRegistrationOptions,
  ): Promise<LocalRegistration> {
    throw new Error(NOT_WIRED);
  }

  async establishSession(
    _peerAccountId: string,
    _peerDeviceId: number,
    _peerBundle: PublishedKeyBundle,
  ): Promise<void> {
    throw new Error(NOT_WIRED);
  }

  async encrypt(
    _peerAccountId: string,
    _peerDeviceId: number,
    _plaintext: string,
  ): Promise<EncryptedMessage> {
    throw new Error(NOT_WIRED);
  }

  async decrypt(
    _peerAccountId: string,
    _peerDeviceId: number,
    _encrypted: EncryptedMessage,
  ): Promise<string> {
    throw new Error(NOT_WIRED);
  }
}
