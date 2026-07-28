/**
 * Client-side media upload/download orchestration.
 *
 * Ties the encryption core (`MediaCipher`) to the media service (presigned R2
 * URLs): encrypt → presigned PUT → return a `MediaReference` for the E2EE body;
 * and presigned GET → download → decrypt. The plaintext and key never leave the
 * device, and the ciphertext goes straight to R2 (the service only signs URLs).
 */
import {
  decryptMedia,
  encryptMedia,
  type MediaCipher,
  type MediaPlaintext,
  type MediaReference,
} from "./media.js";

/** Minimal fetch shape (matches the global and injected impls). */
type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: Uint8Array;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** The two presigned-URL endpoints (see backend/media). */
export interface MediaService {
  uploadUrl(): Promise<{ url: string; locator: string; expiresIn: number }>;
  downloadUrl(locator: string): Promise<{ url: string; expiresIn: number }>;
}

/** HTTP `MediaService` backed by the Go media service. */
export class HttpMediaService implements MediaService {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  async uploadUrl(): Promise<{ url: string; locator: string; expiresIn: number }> {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/media/upload-url`, {
      method: "POST",
    });
    if (!res.ok) throw new Error(`media upload-url failed: ${res.status}`);
    return res.json();
  }

  async downloadUrl(locator: string): Promise<{ url: string; expiresIn: number }> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/v1/media/download-url?locator=${encodeURIComponent(locator)}`,
    );
    if (!res.ok) throw new Error(`media download-url failed: ${res.status}`);
    return res.json();
  }
}

/**
 * Encrypt `media`, upload the ciphertext to R2 via a presigned PUT, and return
 * the full `MediaReference` (key material + locator) to put in the E2EE body.
 */
export async function uploadMedia(
  cipher: MediaCipher,
  service: MediaService,
  media: MediaPlaintext,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<MediaReference> {
  const enc = await encryptMedia(cipher, media);
  const { url, locator } = await service.uploadUrl();
  const put = await fetchImpl(url, {
    method: "PUT",
    body: enc.ciphertext,
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (!put.ok) throw new Error(`media PUT failed: ${put.status}`);
  return { ...enc.keyMaterial, locator };
}

/**
 * Download the ciphertext for `ref` via a presigned GET and decrypt it,
 * verifying the GCM tag and the plaintext hash.
 */
export async function downloadMedia(
  cipher: MediaCipher,
  service: MediaService,
  ref: MediaReference,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<MediaPlaintext> {
  const { url } = await service.downloadUrl(ref.locator);
  const resp = await fetchImpl(url);
  if (!resp.ok) throw new Error(`media GET failed: ${resp.status}`);
  const ciphertext = new Uint8Array(await resp.arrayBuffer());
  return decryptMedia(cipher, ciphertext, ref);
}
