// PKCE (RFC 7636) and state generation/verification helpers.
// Uses node:crypto only.

import crypto from 'node:crypto';

/**
 * Generate a cryptographically random state value (base64url, 32 bytes).
 * @returns {string}
 */
export function generateState() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate a PKCE code verifier (RFC 7636 s.4.1: 43-128 unreserved chars).
 * We use 64 random bytes -> 86-char base64url string, well within range.
 * @returns {string}
 */
export function generateCodeVerifier() {
  return crypto.randomBytes(64).toString('base64url');
}

/**
 * Derive the S256 code_challenge from a code_verifier.
 * code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
 * @param {string} verifier
 * @returns {string}
 */
export function deriveCodeChallenge(verifier) {
  return crypto
    .createHash('sha256')
    .update(verifier, 'ascii')
    .digest('base64url');
}

/**
 * Constant-time comparison of two strings.
 * Returns false (not throws) on unequal lengths.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Build a signed state cookie payload: { state, codeVerifier }.
 * We piggyback on the existing session HMAC key so no new secret is needed.
 *
 * Format: base64url(JSON{state,cv}) + "." + HMAC
 *
 * @param {object} opts
 * @param {string} opts.state
 * @param {string} opts.codeVerifier
 * @param {string} opts.hmacKey
 * @returns {string}
 */
export function signStateCookie({ state, codeVerifier, hmacKey }) {
  const payload = Buffer.from(JSON.stringify({ state, cv: codeVerifier })).toString('base64url');
  const sig = crypto.createHmac('sha256', hmacKey).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/**
 * Verify and parse a state cookie produced by signStateCookie.
 * @param {string} token
 * @param {string} hmacKey
 * @returns {{ valid: boolean, state?: string, codeVerifier?: string, reason?: string }}
 */
export function verifyStateCookie(token, hmacKey) {
  if (!token || typeof token !== 'string') return { valid: false, reason: 'missing' };
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { valid: false, reason: 'malformed' };

  const payloadB64 = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const expectedSig = crypto.createHmac('sha256', hmacKey).update(payloadB64).digest('base64url');

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'bad_signature' };
  }

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'bad_payload' };
  }

  if (!parsed.state || !parsed.cv) return { valid: false, reason: 'incomplete' };
  return { valid: true, state: parsed.state, codeVerifier: parsed.cv };
}
