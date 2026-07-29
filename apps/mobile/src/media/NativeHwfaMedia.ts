/**
 * Typed access to the `HwfaMedia` native module (AES-256-GCM; see
 * android/.../media/HwfaMediaModule.kt). All bytes cross as base64 strings.
 */
import { NativeModules } from 'react-native';

export interface NativeHwfaMediaSpec {
  randomBytes(length: number): Promise<string>;
  sha256(dataB64: string): Promise<string>;
  encrypt(keyB64: string, ivB64: string, plaintextB64: string): Promise<string>;
  decrypt(keyB64: string, ivB64: string, ciphertextB64: string): Promise<string>;
}

const native = NativeModules.HwfaMedia as NativeHwfaMediaSpec | undefined;

export function hasNativeMedia(): boolean {
  return !!native;
}

export function getNativeMedia(): NativeHwfaMediaSpec {
  if (!native) {
    throw new Error(
      'HwfaMedia native module is not linked. Rebuild the app (npm run android) — ' +
        'a JS-only reload cannot pick up new native modules.',
    );
  }
  return native;
}
