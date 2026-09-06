/**
 * File picker + saver — thin JS wrappers over the `HwfaImagePicker` native
 * module (see android/.../media/HwfaImagePickerModule.kt), for arbitrary files
 * rather than only images.
 *
 * `pickFile` opens the system chooser for any type and returns the raw bytes so
 * they can be encrypted before upload — identical to the image path, just an
 * unrestricted MIME filter. `saveToDownloads` writes decrypted bytes back out to
 * the public Downloads collection so a received attachment can leave the app.
 */
import { NativeModules } from 'react-native';
import type { MediaPlaintext } from '@hwfa/client';
import { base64ToBytes, bytesToBase64 } from './rnMediaCipher';

interface PickedFile {
  dataB64: string;
  mime: string;
  name: string;
  size: number;
}

interface NativeFileSpec {
  pickFile?(): Promise<PickedFile | null>;
  saveToDownloads?(dataB64: string, name: string, mime: string): Promise<string>;
}

const native = NativeModules.HwfaImagePicker as NativeFileSpec | undefined;

/** Whether the native build supports arbitrary-file picking (vs. an old build). */
export function hasFilePicker(): boolean {
  return !!native?.pickFile;
}

/** Whether the native build can save decrypted bytes to Downloads. */
export function hasFileSaver(): boolean {
  return !!native?.saveToDownloads;
}

/**
 * Open the system file chooser. Resolves with the plaintext bytes + metadata,
 * or null if the user cancelled. Throws if the native module isn't linked.
 */
export async function pickFile(): Promise<MediaPlaintext | null> {
  if (!native?.pickFile) {
    throw new Error(
      'HwfaImagePicker.pickFile is not available. Rebuild the app (npm run android).',
    );
  }
  const picked = await native.pickFile();
  if (!picked) return null;
  return {
    bytes: base64ToBytes(picked.dataB64),
    mime: picked.mime,
    name: picked.name,
  };
}

/**
 * Write decrypted attachment bytes to the public Downloads folder. Resolves with
 * the saved file name / path. Throws if the native saver isn't available.
 */
export async function saveToDownloads(media: MediaPlaintext): Promise<string> {
  if (!native?.saveToDownloads) {
    throw new Error(
      'HwfaImagePicker.saveToDownloads is not available. Rebuild the app (npm run android).',
    );
  }
  return native.saveToDownloads(bytesToBase64(media.bytes), media.name ?? 'file', media.mime);
}
