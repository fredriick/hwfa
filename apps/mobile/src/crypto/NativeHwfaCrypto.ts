/**
 * Typed access to the `HwfaCrypto` native module (see
 * android/.../crypto/HwfaCryptoModule.kt). This is the thin JS ↔ native seam;
 * `rnCryptoProvider.ts` adapts it to the `CryptoProvider` interface.
 */
import { NativeModules } from 'react-native';
import type {
  EncryptedMessage,
  LocalRegistration,
  PublishedKeyBundle,
} from '@hwfa/client';

/** The native surface, mirroring HwfaCryptoModule's @ReactMethods. */
export interface NativeHwfaCryptoSpec {
  generateRegistration(deviceId: number, oneTimeCount: number): Promise<LocalRegistration>;
  establishSession(
    peerId: string,
    peerDeviceId: number,
    bundle: PublishedKeyBundle,
  ): Promise<null>;
  encrypt(
    peerId: string,
    peerDeviceId: number,
    plaintext: string,
  ): Promise<EncryptedMessage>;
  decrypt(
    peerId: string,
    peerDeviceId: number,
    type: number,
    ciphertextB64: string,
  ): Promise<string>;

  /** Resume support — the native store persists identity + the account id. */
  isRegistered(): Promise<boolean>;
  saveAccount(accountId: string, phone: string): Promise<null>;
  loadAccount(): Promise<SavedAccount | null>;
  reset(): Promise<null>;
}

/** A previously onboarded identity, persisted on-device for resume. */
export interface SavedAccount {
  accountId: string;
  deviceId: number;
  phone: string;
}

const native = NativeModules.HwfaCrypto as NativeHwfaCryptoSpec | undefined;

export function getNativeCrypto(): NativeHwfaCryptoSpec {
  if (!native) {
    throw new Error(
      'HwfaCrypto native module is not linked. Rebuild the app (npm run android) — ' +
        'a JS-only reload cannot pick up new native modules.',
    );
  }
  return native;
}
