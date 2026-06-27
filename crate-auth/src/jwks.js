// JWKS fetching/caching and JWT verification.
//
// Supports ES256 (EC P-256, IEEE-P1363 R||S) and RS256 (RSA PKCS#1v1.5).
// Algorithm is determined from the JWK kty field and validated against the
// OAUTH_ALLOWED_ALGS allowlist (default: ES256,RS256).
//
// mycelium signs proof-of-tap JWTs with ES256 (EC P-256) and publishes its
// public keys at /.well-known/jwks.json. Each JWK is of the form:
//   { kty: "EC", crv: "P-256", kid, use: "sig", alg: "ES256", x, y }
// The JWT header carries the matching `kid`.
//
// RS256 JWKs: { kty: "RSA", kid, use: "sig", alg: "RS256", n, e, ... }

import crypto from 'node:crypto';

let cache = {
  keysByKid: new Map(),
  expiresAt: 0, // unix ms
};

function b64urlJson(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/** Parse a Cache-Control header's max-age (seconds), or null. */
function parseMaxAge(cacheControl) {
  if (!cacheControl) return null;
  const m = /max-age=(\d+)/.exec(cacheControl);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Fetch and cache the JWKS. Honors Cache-Control max-age; falls back to the
 * configured TTL. Exported so callers can force a refresh on a kid miss.
 */
export async function refreshJwks({ jwksUrl, fallbackTtlSeconds = 3600, fetchImpl = fetch }) {
  const res = await fetchImpl(jwksUrl, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
  }
  const body = await res.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  const keysByKid = new Map();
  for (const jwk of keys) {
    if (jwk && jwk.kid) keysByKid.set(jwk.kid, jwk);
  }
  const ttl = parseMaxAge(res.headers.get('cache-control')) ?? fallbackTtlSeconds;
  cache = { keysByKid, expiresAt: Date.now() + ttl * 1000 };
  return cache;
}

async function getKey(kid, opts) {
  const fresh = cache.expiresAt > Date.now();
  if (fresh && cache.keysByKid.has(kid)) {
    return cache.keysByKid.get(kid);
  }
  // Stale, or kid not present -> refresh once and retry.
  await refreshJwks(opts);
  return cache.keysByKid.get(kid) || null;
}

/** Test/utility hook to reset the module-level cache. */
export function _resetCache() {
  cache = { keysByKid: new Map(), expiresAt: 0 };
}

/**
 * Determine the algorithm name from a JWK.
 * - kty=EC, crv=P-256 -> ES256
 * - kty=RSA            -> RS256
 * Explicit `alg` field on the JWK takes precedence if present.
 */
function algFromJwk(jwk) {
  if (jwk.alg) return jwk.alg;
  if (jwk.kty === 'EC') return 'ES256';
  if (jwk.kty === 'RSA') return 'RS256';
  return null;
}

/**
 * Verify a JWT signature using the appropriate algorithm based on the JWK kty.
 * ES256: EC P-256, IEEE-P1363 raw R||S signature.
 * RS256: RSA PKCS#1 v1.5 SHA-256 (DER-encoded).
 */
function verifySignature(signingInput, signatureB64url, jwk) {
  const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signature = Buffer.from(signatureB64url, 'base64url');
  const data = Buffer.from(signingInput);

  const alg = algFromJwk(jwk);

  if (alg === 'ES256') {
    return crypto.verify(
      'sha256',
      data,
      { key: keyObject, dsaEncoding: 'ieee-p1363' },
      signature,
    );
  }

  if (alg === 'RS256') {
    return crypto.verify(
      'sha256',
      data,
      { key: keyObject },
      signature,
    );
  }

  throw new Error(`unsupported_alg:${alg}`);
}

/**
 * Verify a JWT: signature against JWKS, plus iss/aud/exp/nbf.
 *
 * @param {string} token
 * @param {object} opts
 * @param {string}   opts.jwksUrl
 * @param {number}   [opts.fallbackTtlSeconds=3600]
 * @param {string}   [opts.expectedIssuer]
 * @param {string}   [opts.expectedAudience]
 * @param {string[]} [opts.allowedAlgs=['ES256','RS256']]
 * @param {function} [opts.fetchImpl=fetch]
 * @param {number}   [opts.now] - unix seconds override (for tests)
 * @returns {Promise<{valid: boolean, claims?: object, reason?: string}>}
 */
export async function verifyJwt(token, {
  jwksUrl,
  fallbackTtlSeconds = 3600,
  expectedIssuer,
  expectedAudience,
  allowedAlgs = ['ES256', 'RS256'],
  fetchImpl = fetch,
  now,
} = {}) {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'missing' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, reason: 'malformed' };

  let header;
  let claims;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
  } catch {
    return { valid: false, reason: 'bad_encoding' };
  }

  // Check algorithm against allowlist (header.alg).
  if (!allowedAlgs.includes(header.alg)) {
    return { valid: false, reason: 'bad_alg' };
  }
  if (!header.kid) return { valid: false, reason: 'no_kid' };

  let jwk;
  try {
    jwk = await getKey(header.kid, { jwksUrl, fallbackTtlSeconds, fetchImpl });
  } catch (err) {
    return { valid: false, reason: `jwks_error:${err.message}` };
  }
  if (!jwk) return { valid: false, reason: 'unknown_kid' };

  // Cross-check: JWK alg must also be in the allowlist.
  const jwkAlg = algFromJwk(jwk);
  if (jwkAlg && !allowedAlgs.includes(jwkAlg)) {
    return { valid: false, reason: 'bad_alg' };
  }

  let ok = false;
  try {
    const signingInput = `${parts[0]}.${parts[1]}`;
    ok = verifySignature(signingInput, parts[2], jwk);
  } catch (err) {
    return { valid: false, reason: `verify_error:${err.message}` };
  }
  if (!ok) return { valid: false, reason: 'bad_signature' };

  const nowSec = now ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && claims.exp <= nowSec) {
    return { valid: false, reason: 'expired' };
  }
  if (typeof claims.nbf === 'number' && claims.nbf > nowSec + 60) {
    return { valid: false, reason: 'not_yet_valid' };
  }
  if (expectedIssuer && claims.iss !== expectedIssuer) {
    return { valid: false, reason: 'bad_issuer' };
  }
  if (expectedAudience) {
    const aud = claims.aud;
    const audList = Array.isArray(aud) ? aud : aud ? [aud] : [];
    if (!audList.includes(expectedAudience)) {
      return { valid: false, reason: 'bad_audience' };
    }
  }

  return { valid: true, claims };
}

/**
 * Back-compat alias: verifyMyceliumJwt -> verifyJwt.
 * Existing callers (server.js, tests) continue to work unchanged.
 */
export async function verifyMyceliumJwt(token, opts) {
  // In tap-initiated / mycelium mode, ES256 is the expected alg.
  // The alias passes through; allowedAlgs defaults to ES256,RS256.
  return verifyJwt(token, opts);
}
