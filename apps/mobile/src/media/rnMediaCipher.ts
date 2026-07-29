/**
 * React Native `MediaCipher` — backed by the `HwfaMedia` native module
 * (AES-256-GCM via Android's javax.crypto). Byte-compatible with the Web Crypto
 * cipher used on Node/web, so attachments cross platforms.
 *
 * Bytes cross the bridge as base64; the helpers below convert without relying on
 * `atob`/`btoa` or `Buffer`, which Hermes does not provide.
 */
import type { MediaCipher } from '@hwfa/client';
import { getNativeMedia } from './NativeHwfaMedia';

export class RNMediaCipher implements MediaCipher {
  async randomBytes(length: number): Promise<Uint8Array> {
    return base64ToBytes(await getNativeMedia().randomBytes(length));
  }

  async sha256B64(data: Uint8Array): Promise<string> {
    return getNativeMedia().sha256(bytesToBase64(data));
  }

  async encrypt(keyB64: string, ivB64: string, plaintext: Uint8Array): Promise<Uint8Array> {
    const ct = await getNativeMedia().encrypt(keyB64, ivB64, bytesToBase64(plaintext));
    return base64ToBytes(ct);
  }

  async decrypt(keyB64: string, ivB64: string, ciphertext: Uint8Array): Promise<Uint8Array> {
    const pt = await getNativeMedia().decrypt(keyB64, ivB64, bytesToBase64(ciphertext));
    return base64ToBytes(pt);
  }
}

export const rnMediaCipher = new RNMediaCipher();

// --- pure-JS base64 (standard alphabet, with padding) ---

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i++) m[ALPHABET[i]!] = i;
  return m;
})();

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? ALPHABET[b2 & 0x3f] : '=';
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '');
  const len = Math.floor((clean.length * 6) / 8);
  const out = new Uint8Array(len);
  let acc = 0;
  let bits = 0;
  let p = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | LOOKUP[clean[i]!]!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}
