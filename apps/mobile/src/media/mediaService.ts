/**
 * App-level media orchestration.
 *
 * Wires the portable upload/download helpers (`@hwfa/client`) to the platform:
 * the native AES-256-GCM cipher (`rnMediaCipher`) and the Go media service
 * (presigned R2 URLs) at `config.mediaUrl`. Screens/store call `uploadImage` to
 * turn plaintext bytes into a `MediaReference` for the E2EE body, and
 * `downloadImage` to fetch + decrypt an inbound attachment.
 */
import {
  HttpMediaService,
  downloadMedia,
  uploadMedia,
  type MediaPlaintext,
  type MediaReference,
} from '@hwfa/client';
import { rnMediaCipher, bytesToBase64 } from './rnMediaCipher';
import { config } from '../config';

const service = new HttpMediaService(config.mediaUrl);

/** Encrypt + upload; returns the reference to embed in the E2EE message body. */
export function uploadImage(media: MediaPlaintext): Promise<MediaReference> {
  return uploadMedia(rnMediaCipher, service, media);
}

/** Fetch + decrypt an inbound attachment into plaintext bytes. */
export function downloadImage(ref: MediaReference): Promise<MediaPlaintext> {
  return downloadMedia(rnMediaCipher, service, ref);
}

/** A `data:` URI for an in-memory image, suitable for `<Image source>`. */
export function toDataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}
