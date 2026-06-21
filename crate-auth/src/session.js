// Self-signed session tokens.
//
// A session is a compact, stateless, HMAC-signed token of the form:
//   base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload))
//
// Payload: { sub, iat, exp } where iat/exp are unix seconds.
// Verification recomputes the HMAC (constant-time compare) and checks exp.

import crypto from 'node:crypto';

const DAY_SECONDS = 24 * 60 * 60;

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payloadB64, hmacKey) {
  return crypto
    .createHmac('sha256', hmacKey)
    .update(payloadB64)
    .digest('base64url');
}

/**
 * Create a signed session token.
 * @param {object} opts
 * @param {string} opts.hmacKey - signing key (SESSION_HMAC_KEY)
 * @param {number} opts.ttlDays - lifetime in days
 * @param {string} [opts.subject] - session subject
 * @param {number} [opts.now] - override current unix seconds (for tests)
 */
export function signSession({ hmacKey, ttlDays, subject = 'crate', now }) {
  if (!hmacKey) throw new Error('signSession: hmacKey required');
  const iat = now ?? Math.floor(Date.now() / 1000);
  const exp = iat + Math.round(ttlDays * DAY_SECONDS);
  const payload = { sub: subject, iat, exp };
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  const sig = sign(payloadB64, hmacKey);
  return `${payloadB64}.${sig}`;
}

/**
 * Verify a signed session token.
 * @returns {{valid: boolean, payload?: object, reason?: string}}
 */
export function verifySession(token, { hmacKey, now } = {}) {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'missing' };
  }
  if (!hmacKey) throw new Error('verifySession: hmacKey required');

  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) {
    return { valid: false, reason: 'malformed' };
  }
  const payloadB64 = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const expectedSig = sign(payloadB64, hmacKey);

  // Constant-time comparison; length-guard first since timingSafeEqual throws
  // on unequal lengths.
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'bad_signature' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'bad_payload' };
  }

  const nowSec = now ?? Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, payload };
}
