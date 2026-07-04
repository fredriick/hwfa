/**
 * Message content — the *plaintext* payload that gets encrypted into an
 * envelope's ciphertext. This never touches the server; it only exists
 * on-device after decryption (and before encryption).
 */

export type MessageContentType = "text" | "media" | "receipt" | "typing";

/** A plaintext message body, serialized to JSON then encrypted by libsignal. */
export interface MessageBody {
  /** Client-generated id for local dedup / ordering. */
  clientId: string;
  type: MessageContentType;
  /** Present when `type === "text"`. */
  text?: string;
  /** Present when `type === "media"` — the media key travels here, E2EE. */
  media?: MediaReference;
  /** Epoch milliseconds, sender clock. */
  sentAt: number;
}

/**
 * Reference to an encrypted blob in the media store. The AES key never leaves
 * this structure, which itself is inside the E2EE message body — so the server
 * that stores the blob cannot decrypt it.
 */
export interface MediaReference {
  /** Opaque object key in R2. */
  blobId: string;
  /** Base64 AES-256-GCM key used to encrypt the blob client-side. */
  keyB64: string;
  /** Base64 nonce/IV. */
  nonceB64: string;
  mimeType: string;
  byteLength: number;
}
