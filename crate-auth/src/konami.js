// Konami sequence matching for the decoy-page backdoor.
//
// The configured sequence and the submitted sequence are both normalized to a
// lowercase, trimmed, comma-joined string before comparison so that callers may
// submit either an array of tokens or a comma-delimited string.

import crypto from 'node:crypto';

/** Normalize a sequence (array or comma string) to a canonical token array. */
export function normalizeSequence(seq) {
  let tokens;
  if (Array.isArray(seq)) {
    tokens = seq;
  } else if (typeof seq === 'string') {
    tokens = seq.split(',');
  } else {
    return [];
  }
  return tokens
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => t.length > 0);
}

/**
 * Constant-time check that `submitted` matches `expected`.
 * @param {string|string[]} submitted
 * @param {string|string[]} expected
 * @returns {boolean}
 */
export function matchKonami(submitted, expected) {
  const a = normalizeSequence(submitted).join(',');
  const b = normalizeSequence(expected).join(',');
  if (a.length === 0 || b.length === 0) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
