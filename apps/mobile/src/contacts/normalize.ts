/**
 * Best-effort E.164 phone normalization for contact discovery.
 *
 * Contact hashes must match the number the peer registered with (e.g. "+234801…"),
 * so a locally-formatted address-book entry ("0801 234 5678", "(080) 1234-5678")
 * has to be canonicalized the same way. This is a pragmatic Phase-1 normalizer,
 * not a full libphonenumber: it strips formatting and resolves a leading 0 to the
 * user's own country calling code. Numbers it can't confidently normalize are
 * still hashed as-is — they just won't match unless already E.164.
 */

/** Calling codes we recognize when inferring the user's country (longest-match). */
const KNOWN_CALLING_CODES = [
  '234', // Nigeria
  '254', // Kenya
  '233', // Ghana
  '256', // Uganda
  '255', // Tanzania
  '250', // Rwanda
  '260', // Zambia
  '263', // Zimbabwe
  '27', // South Africa
  '212', // Morocco
  '20', // Egypt
  '251', // Ethiopia
  '225', // Côte d'Ivoire
  '221', // Senegal
  '44', // UK
  '1', // US / Canada
  '91', // India
  '971', // UAE
  '966', // Saudi Arabia
];

/** The country calling code of an E.164 number, or null if unrecognized. */
export function callingCodeOf(e164: string): string | null {
  const digits = e164.replace(/[^\d]/g, '');
  // Longest known prefix wins (so "234" beats "23" would-be codes).
  const byLength = [...KNOWN_CALLING_CODES].sort((a, b) => b.length - a.length);
  for (const code of byLength) {
    if (digits.startsWith(code)) return code;
  }
  return null;
}

/**
 * Normalize a raw phone string to E.164 (`+<digits>`), using `defaultCallingCode`
 * (no `+`, e.g. "234") to resolve national-format numbers. Returns null if the
 * result has too few digits to be a real number.
 */
export function normalizeE164(raw: string, defaultCallingCode?: string): string | null {
  if (!raw) return null;
  // Keep a leading +, drop every other non-digit (spaces, dashes, parens, dots).
  let s = raw.trim().replace(/[^\d+]/g, '');
  if (s.startsWith('+')) {
    s = '+' + s.slice(1).replace(/\D/g, '');
  } else if (s.startsWith('00')) {
    // International prefix form: 00<cc><number> → +<cc><number>.
    s = '+' + s.slice(2);
  } else if (s.startsWith('0') && defaultCallingCode) {
    // National trunk 0 → replace with the country calling code.
    s = '+' + defaultCallingCode + s.slice(1);
  } else if (defaultCallingCode) {
    // Bare national number with no trunk 0.
    s = '+' + defaultCallingCode + s;
  } else {
    s = '+' + s;
  }
  const digits = s.slice(1);
  // E.164 allows up to 15 digits; require at least 7 to reject junk/short codes.
  if (digits.length < 7 || digits.length > 15) return null;
  return s;
}
