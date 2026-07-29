/**
 * On-device sanity check for the native AES-256-GCM cipher.
 *
 * 1. Round-trips a random payload (encrypt → decrypt → bytes match).
 * 2. Confirms byte-compatibility with the Web Crypto cipher by encrypting a
 *    fixed key/IV/plaintext and comparing to the ciphertext computed by Node's
 *    WebCrypto — if these match, media encrypted on Android decrypts on web/Node.
 *
 * Logs `[media] self-test ...` so it can be verified in logcat. Dev aid only.
 */
import { encryptMedia, decryptMedia } from '@hwfa/client';
import { rnMediaCipher, bytesToBase64, base64ToBytes } from './rnMediaCipher';
import { hasNativeMedia } from './NativeHwfaMedia';

// Fixed vector — WebCrypto AES-256-GCM(key=32×0x01, iv=12×0x02, "hwfa media cipher test").
const FIXED_KEY_B64 = 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=';
const FIXED_IV_B64 = 'AgICAgICAgICAgIC';
const FIXED_PT = 'hwfa media cipher test';
const FIXED_CT_B64 = 'b6GvKGo6pJm6rZyrNdeq19CVpYqYxYyaK5Drb8Hry73E1q9FB60=';

function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
  return new Uint8Array(out);
}

export async function mediaCipherSelfTest(): Promise<void> {
  if (!hasNativeMedia()) {
    console.log('[media] self-test skipped (native module not linked)');
    return;
  }
  try {
    // 1) round-trip a random payload through the full media helpers.
    const payload = base64ToBytes(await rnMediaCipher.randomBytes(1024).then(bytesToBase64));
    const enc = await encryptMedia(rnMediaCipher, {
      bytes: payload,
      mime: 'application/octet-stream',
    });
    const dec = await decryptMedia(rnMediaCipher, enc.ciphertext, {
      ...enc.keyMaterial,
      locator: 'self-test',
    });
    const roundTrips =
      dec.bytes.length === payload.length && dec.bytes.every((b, i) => b === payload[i]);

    // 2) fixed vector must match the WebCrypto ciphertext exactly.
    const ct = await rnMediaCipher.encrypt(FIXED_KEY_B64, FIXED_IV_B64, utf8(FIXED_PT));
    const compatible = bytesToBase64(ct) === FIXED_CT_B64;

    console.log(
      `[media] self-test round-trip=${roundTrips} webcrypto-compatible=${compatible}`,
    );
  } catch (e) {
    console.log('[media] self-test error:', e instanceof Error ? e.message : String(e));
  }
}
