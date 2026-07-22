/**
 * React Native CryptoProvider — backed by the `HwfaCrypto` native module.
 *
 * The native module (android/.../crypto/HwfaCryptoModule.kt) wraps the official
 * Signal Rust core via `org.signal:libsignal-android` — the same core as the
 * Node `@signalapp/libsignal-client`, so bundles + ciphertext are byte-for-byte
 * compatible with the backend and the `@hwfa/client` headless tests.
 *
 * This class is a thin adapter: it holds no key material (the native store does)
 * and just forwards the four `CryptoProvider` operations across the bridge.
 *
 * STATUS: Android implemented. iOS pending (the equivalent module over Signal's
 * official Swift `LibSignalClient`). Ratchet state is in-memory in the native
 * module for Phase 1 — persist to SQLCipher + Keystore before release.
 *
 * LICENSING: libsignal is AGPL-3.0 — a product/legal decision to settle before
 * shipping (see the native module header).
 */
import type {
  CryptoProvider,
  EncryptedMessage,
  GenerateRegistrationOptions,
  LocalRegistration,
  PublishedKeyBundle,
} from '@hwfa/client';
import { getNativeCrypto } from './NativeHwfaCrypto';

const DEFAULT_ONE_TIME_PREKEYS = 10;

export class RNCryptoProvider implements CryptoProvider {
  generateRegistration(
    opts: GenerateRegistrationOptions = {},
  ): Promise<LocalRegistration> {
    return getNativeCrypto().generateRegistration(
      opts.deviceId ?? 1,
      opts.oneTimePreKeyCount ?? DEFAULT_ONE_TIME_PREKEYS,
    );
  }

  async establishSession(
    peerAccountId: string,
    peerDeviceId: number,
    peerBundle: PublishedKeyBundle,
  ): Promise<void> {
    await getNativeCrypto().establishSession(peerAccountId, peerDeviceId, peerBundle);
  }

  encrypt(
    peerAccountId: string,
    peerDeviceId: number,
    plaintext: string,
  ): Promise<EncryptedMessage> {
    return getNativeCrypto().encrypt(peerAccountId, peerDeviceId, plaintext);
  }

  decrypt(
    peerAccountId: string,
    peerDeviceId: number,
    encrypted: EncryptedMessage,
  ): Promise<string> {
    return getNativeCrypto().decrypt(
      peerAccountId,
      peerDeviceId,
      encrypted.type,
      encrypted.ciphertextB64,
    );
  }
}
