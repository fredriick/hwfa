/**
 * Safety numbers — an out-of-band identity check.
 *
 * Two users who read the same safety number aloud (or scan it) confirm no
 * machine-in-the-middle sits between their identity keys. It is derived purely
 * from the two public identity keys, so both sides compute the SAME value
 * regardless of who is "local": the keys are combined in sorted order.
 *
 * This is a portable, dependency-free fingerprint (bundled SHA-256, so it works
 * in Node, RN/Hermes, and browsers alike). It is not byte-compatible with
 * Signal's NumericFingerprintGenerator — it serves the same purpose (a stable,
 * symmetric, collision-resistant number to compare) without binding the check
 * to the native crypto engine.
 */
import { sha256 } from "./sha256.js";

/** Iterated hashing gives a work factor so the displayed number resists attack. */
const ITERATIONS = 5200;
const GROUPS = 12; // 12 groups of 5 digits = a 60-digit number, like other apps
const GROUP_MOD = 100000;

/**
 * A stable 60-digit safety number for a pair of base64 identity public keys.
 * Symmetric: `safetyNumber(a, b) === safetyNumber(b, a)`. Rendered as 12
 * space-separated 5-digit groups.
 */
export function safetyNumber(identityKeyAB64: string, identityKeyBB64: string): string {
  const a = base64ToBytes(identityKeyAB64);
  const b = base64ToBytes(identityKeyBB64);
  const [lo, hi] = compareBytes(a, b) <= 0 ? [a, b] : [b, a];

  // Iterated hash over the sorted key pair for a work factor.
  let h = sha256(concat(lo, hi));
  for (let i = 0; i < ITERATIONS; i++) h = sha256(concat(h, concat(lo, hi)));

  // Expand to GROUPS*5 digits: block_k = sha256(h || k) gives fresh bytes.
  const digits: string[] = [];
  for (let k = 0; k < GROUPS; k++) {
    const block = sha256(concat(h, Uint8Array.of(k)));
    // First 5 bytes → a number mod 100000, zero-padded to 5 digits.
    let n = 0;
    for (let j = 0; j < 5; j++) n = (n * 256 + block[j]!) % GROUP_MOD;
    digits.push(String(n).padStart(5, "0"));
  }
  return digits.join(" ");
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Lexicographic byte comparison (-1 / 0 / 1). */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
  }
  return a.length - b.length;
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}
