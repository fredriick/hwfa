/**
 * Encrypted media attachments.
 *
 * Media is encrypted on the sender's device with a fresh random AES-256-GCM key,
 * the ciphertext is uploaded to object storage (Phase-1 backend: Cloudflare R2),
 * and only a small `MediaReference` — the key, IV, and storage locator — travels
 * inside the E2EE message body. The storage service therefore holds ciphertext
 * it cannot read, and the key only ever exists on the two devices.
 *
 * The actual cipher sits behind the `MediaCipher` seam (like `CryptoProvider`
 * for libsignal): Node and browsers use `WebCryptoMediaCipher` (Web Crypto
 * AES-GCM); React Native supplies a native cipher, since Hermes has no
 * `crypto.subtle`. The portable core here never binds to a specific engine.
 */

/** A fresh symmetric key + IV for one attachment (base64), plus its metadata. */
export interface MediaKeyMaterial {
  /** base64 AES-256 key (32 bytes). */
  keyB64: string;
  /** base64 GCM IV / nonce (12 bytes). */
  ivB64: string;
  /** MIME type of the plaintext, e.g. "image/jpeg". */
  mime: string;
  /** Plaintext byte length (the ciphertext is longer by the GCM tag). */
  size: number;
  /** base64 sha256 of the plaintext — an integrity check independent of GCM. */
  sha256B64: string;
  /** Optional original file name. */
  name?: string;
}

/**
 * Everything the recipient needs to fetch and decrypt an attachment. The
 * `locator` is assigned by the storage upload; the rest is `MediaKeyMaterial`.
 * This whole object is serialized into the E2EE message body.
 */
export interface MediaReference extends MediaKeyMaterial {
  /** Storage locator (object id / URL) returned by the upload. */
  locator: string;
}

/** The cipher seam. Implementations must use AES-256-GCM. */
export interface MediaCipher {
  /** Encrypt `plaintext` with `keyB64`/`ivB64`; returns ciphertext‖tag bytes. */
  encrypt(keyB64: string, ivB64: string, plaintext: Uint8Array): Promise<Uint8Array>;
  /** Decrypt `ciphertext` (ciphertext‖tag); throws on auth failure. */
  decrypt(keyB64: string, ivB64: string, ciphertext: Uint8Array): Promise<Uint8Array>;
  /** Cryptographically-random bytes (key/IV generation). Async so a native
   *  bridge (React Native) can implement it. */
  randomBytes(length: number): Promise<Uint8Array>;
  /** base64 sha256 of `data`. */
  sha256B64(data: Uint8Array): Promise<string>;
}

/** Body-text marker so a media message rides the existing text send/receive path. */
const MEDIA_PREFIX = "hwfa-media:";

/** The plaintext side of one attachment, ready to encrypt. */
export interface MediaPlaintext {
  bytes: Uint8Array;
  mime: string;
  name?: string;
}

/** Result of encrypting: ciphertext to upload + the reference (minus locator). */
export interface EncryptedMedia {
  ciphertext: Uint8Array;
  keyMaterial: MediaKeyMaterial;
}

/**
 * Encrypt an attachment with a fresh key. Returns the ciphertext to upload and
 * the `MediaKeyMaterial`; the caller uploads the ciphertext, then calls
 * `buildMediaBody(keyMaterial, locator)` to get the E2EE message body.
 */
export async function encryptMedia(
  cipher: MediaCipher,
  media: MediaPlaintext,
): Promise<EncryptedMedia> {
  const keyBytes = await cipher.randomBytes(32);
  const ivBytes = await cipher.randomBytes(12);
  const keyB64 = bytesToBase64(keyBytes);
  const ivB64 = bytesToBase64(ivBytes);
  const ciphertext = await cipher.encrypt(keyB64, ivB64, media.bytes);
  const sha256B64 = await cipher.sha256B64(media.bytes);
  return {
    ciphertext,
    keyMaterial: {
      keyB64,
      ivB64,
      mime: media.mime,
      size: media.bytes.length,
      sha256B64,
      ...(media.name ? { name: media.name } : {}),
    },
  };
}

/**
 * Decrypt a downloaded attachment against its reference, verifying both the GCM
 * tag (via `decrypt`) and the plaintext sha256 (defense in depth).
 */
export async function decryptMedia(
  cipher: MediaCipher,
  ciphertext: Uint8Array,
  ref: MediaReference,
): Promise<MediaPlaintext> {
  const bytes = await cipher.decrypt(ref.keyB64, ref.ivB64, ciphertext);
  const digest = await cipher.sha256B64(bytes);
  if (digest !== ref.sha256B64) {
    throw new Error("media integrity check failed: sha256 mismatch");
  }
  return { bytes, mime: ref.mime, ...(ref.name ? { name: ref.name } : {}) };
}

/** Serialize a full reference into a message body string. */
export function buildMediaBody(keyMaterial: MediaKeyMaterial, locator: string): string {
  const ref: MediaReference = { ...keyMaterial, locator };
  return MEDIA_PREFIX + JSON.stringify(ref);
}

/** True if a received message body carries a media reference. */
export function isMediaBody(body: string): boolean {
  return body.startsWith(MEDIA_PREFIX);
}

/** Parse a media message body back into a `MediaReference` (null if not one). */
export function parseMediaBody(body: string): MediaReference | null {
  if (!isMediaBody(body)) return null;
  try {
    return JSON.parse(body.slice(MEDIA_PREFIX.length)) as MediaReference;
  } catch {
    return null;
  }
}

/**
 * Web Crypto (AES-GCM) implementation of `MediaCipher`. Works in Node ≥ 15 and
 * browsers via the global `crypto.subtle`. NOT for React Native (Hermes lacks
 * `crypto.subtle`) — RN provides a native cipher.
 */
export class WebCryptoMediaCipher implements MediaCipher {
  private readonly crypto: Crypto;
  private readonly subtle: SubtleCrypto;

  constructor(cryptoObj: Crypto = globalThis.crypto) {
    if (!cryptoObj?.subtle) {
      throw new Error("WebCryptoMediaCipher requires global crypto.subtle");
    }
    this.crypto = cryptoObj;
    this.subtle = cryptoObj.subtle;
  }

  async randomBytes(length: number): Promise<Uint8Array> {
    const out = new Uint8Array(length);
    this.crypto.getRandomValues(out);
    return out;
  }

  private async importKey(keyB64: string): Promise<CryptoKey> {
    return this.subtle.importKey(
      "raw",
      base64ToBytes(keyB64) as unknown as ArrayBuffer,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
  }

  async encrypt(keyB64: string, ivB64: string, plaintext: Uint8Array): Promise<Uint8Array> {
    const key = await this.importKey(keyB64);
    const buf = await this.subtle.encrypt(
      { name: "AES-GCM", iv: base64ToBytes(ivB64) as unknown as ArrayBuffer },
      key,
      plaintext as unknown as ArrayBuffer,
    );
    return new Uint8Array(buf);
  }

  async decrypt(keyB64: string, ivB64: string, ciphertext: Uint8Array): Promise<Uint8Array> {
    const key = await this.importKey(keyB64);
    const buf = await this.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(ivB64) as unknown as ArrayBuffer },
      key,
      ciphertext as unknown as ArrayBuffer,
    );
    return new Uint8Array(buf);
  }

  async sha256B64(data: Uint8Array): Promise<string> {
    const buf = await this.subtle.digest("SHA-256", data as unknown as ArrayBuffer);
    return bytesToBase64(new Uint8Array(buf));
  }
}

// --- base64 helpers (no globals required) ---

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
  return Buffer.from(bytes).toString("base64");
}
