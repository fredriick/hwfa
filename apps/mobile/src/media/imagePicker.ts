/**
 * Image picker — thin JS wrapper over the `HwfaImagePicker` native module
 * (see android/.../media/HwfaImagePickerModule.kt). Opens the system chooser
 * and returns the raw image bytes so they can be encrypted before upload.
 */
import { NativeModules } from 'react-native';
import type { MediaPlaintext } from '@hwfa/client';
import { base64ToBytes } from './rnMediaCipher';

interface PickedImage {
  dataB64: string;
  mime: string;
  name: string;
  size: number;
}

interface NativeImagePickerSpec {
  pickImage(): Promise<PickedImage | null>;
}

const native = NativeModules.HwfaImagePicker as NativeImagePickerSpec | undefined;

export function hasImagePicker(): boolean {
  return !!native;
}

/**
 * Open the system image chooser. Resolves with the plaintext bytes + metadata,
 * or null if the user cancelled. Throws if the native module isn't linked.
 */
export async function pickImage(): Promise<MediaPlaintext | null> {
  if (!native) {
    throw new Error(
      'HwfaImagePicker native module is not linked. Rebuild the app (npm run android).',
    );
  }
  const picked = await native.pickImage();
  if (!picked) return null;
  return {
    bytes: base64ToBytes(picked.dataB64),
    mime: picked.mime,
    name: picked.name,
  };
}
