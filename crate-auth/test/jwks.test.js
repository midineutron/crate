import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyMyceliumJwt, verifyJwt, _resetCache } from '../src/jwks.js';

const KID = 'test-key-1';
const ISSUER = 'https://mycelium.example';
const AUDIENCE = 'crate-client-id';

// --- ES256 helpers (existing) ---

function makeEcKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = KID;
  jwk.alg = 'ES256';
  jwk.use = 'sig';
  return { privateKey, jwk };
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

// Sign a JWT the way mycelium does: ES256, raw R||S (ieee-p1363) signature.
function signEs256Jwt(claims, privateKey) {
  const header = { alg: 'ES256', kid: KID, typ: 'JWT' };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `${signingInput}.${sig.toString('base64url')}`;
}

// --- RS256 helpers ---

function makeRsaKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' });
  jwk.kid = KID;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  return { privateKey, jwk };
}

// Sign a JWT with RS256 (PKCS#1 v1.5, DER-encoded).
function signRs256Jwt(claims, privateKey) {
  const header = { alg: 'RS256', kid: KID, typ: 'JWT' };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput), privateKey);
  return `${signingInput}.${sig.toString('base64url')}`;
}

function mockFetch(jwk) {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'public, max-age=3600' },
    json: async () => ({ keys: [jwk] }),
  });
}

// ============================================================
// ES256 tests (back-compat via verifyMyceliumJwt alias)
// ============================================================

test('accepts a valid mycelium-style ES256 JWT', async () => {
  _resetCache();
  const { privateKey, jwk } = makeEcKeypair();
  const now = 1_700_000_000;
  const token = signEs256Jwt(
    { iss: ISSUER, aud: [AUDIENCE], sub: 'session-1', tag_id: 'tag-9', iat: now, exp: now + 3600 },
    privateKey,
  );
  const result = await verifyMyceliumJwt(token, {
    jwksUrl: 'http://jwks',
    expectedIssuer: ISSUER,
    expectedAudience: AUDIENCE,
    fetchImpl: mockFetch(jwk),
    now,
  });
  assert.equal(result.valid, true);
  assert.equal(result.claims.sub, 'session-1');
});

test('rejects a JWT with a tampered payload', async () => {
  _resetCache();
  const { privateKey, jwk } = makeEcKeypair();
  const now = 1_700_000_000;
  const token = signEs256Jwt(
    { iss: ISSUER, aud: [AUDIENCE], sub: 'session-1', iat: now, exp: now + 3600 },
    privateKey,
  );
  const parts = token.split('.');
  parts[1] = b64url({ iss: ISSUER, aud: [AUDIENCE], sub: 'attacker', iat: now, exp: now + 3600 });
  const forged = parts.join('.');
  const result = await verifyMyceliumJwt(forged, {
    jwksUrl: 'http://jwks',
    fetchImpl: mockFetch(jwk),
    now,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad_signature');
});

test('rejects wrong audience and wrong issuer', async () => {
  _resetCache();
  const { privateKey, jwk } = makeEcKeypair();
  const now = 1_700_000_000;
  const token = signEs256Jwt(
    { iss: ISSUER, aud: ['someone-else'], sub: 's', iat: now, exp: now + 3600 },
    privateKey,
  );
  const result = await verifyMyceliumJwt(token, {
    jwksUrl: 'http://jwks',
    expectedAudience: AUDIENCE,
    fetchImpl: mockFetch(jwk),
    now,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad_audience');
});

test('rejects an expired JWT', async () => {
  _resetCache();
  const { privateKey, jwk } = makeEcKeypair();
  const now = 1_700_000_000;
  const token = signEs256Jwt({ iss: ISSUER, aud: [AUDIENCE], sub: 's', iat: now - 7200, exp: now - 3600 }, privateKey);
  const result = await verifyMyceliumJwt(token, {
    jwksUrl: 'http://jwks',
    fetchImpl: mockFetch(jwk),
    now,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'expired');
});

// ============================================================
// RS256 tests (new)
// ============================================================

test('accepts a valid RS256 JWT via verifyJwt', async () => {
  _resetCache();
  const { privateKey, jwk } = makeRsaKeypair();
  const now = 1_700_000_000;
  const token = signRs256Jwt(
    { iss: ISSUER, aud: [AUDIENCE], sub: 'oidc-user', iat: now, exp: now + 3600 },
    privateKey,
  );
  const result = await verifyJwt(token, {
    jwksUrl: 'http://jwks',
    expectedIssuer: ISSUER,
    expectedAudience: AUDIENCE,
    allowedAlgs: ['ES256', 'RS256'],
    fetchImpl: mockFetch(jwk),
    now,
  });
  assert.equal(result.valid, true);
  assert.equal(result.claims.sub, 'oidc-user');
});

test('rejects RS256 JWT when RS256 is not in allowlist', async () => {
  _resetCache();
  const { privateKey, jwk } = makeRsaKeypair();
  const now = 1_700_000_000;
  const token = signRs256Jwt(
    { iss: ISSUER, aud: [AUDIENCE], sub: 'oidc-user', iat: now, exp: now + 3600 },
    privateKey,
  );
  // Only allow ES256.
  const result = await verifyJwt(token, {
    jwksUrl: 'http://jwks',
    allowedAlgs: ['ES256'],
    fetchImpl: mockFetch(jwk),
    now,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad_alg');
});

test('rejects a JWT with an algorithm not in the allowlist (e.g. none)', async () => {
  _resetCache();
  const { privateKey, jwk } = makeEcKeypair();
  const now = 1_700_000_000;
  // Craft a JWT with alg=none in header.
  const header = b64url({ alg: 'none', kid: KID, typ: 'JWT' });
  const payload = b64url({ iss: ISSUER, sub: 'hack', iat: now, exp: now + 3600 });
  const token = `${header}.${payload}.`;
  const result = await verifyJwt(token, {
    jwksUrl: 'http://jwks',
    allowedAlgs: ['ES256', 'RS256'],
    fetchImpl: mockFetch(jwk),
    now,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad_alg');
});

test('rejects a tampered RS256 JWT payload', async () => {
  _resetCache();
  const { privateKey, jwk } = makeRsaKeypair();
  const now = 1_700_000_000;
  const token = signRs256Jwt(
    { iss: ISSUER, aud: [AUDIENCE], sub: 'legit', iat: now, exp: now + 3600 },
    privateKey,
  );
  const parts = token.split('.');
  parts[1] = b64url({ iss: ISSUER, aud: [AUDIENCE], sub: 'attacker', iat: now, exp: now + 3600 });
  const forged = parts.join('.');
  const result = await verifyJwt(forged, {
    jwksUrl: 'http://jwks',
    allowedAlgs: ['ES256', 'RS256'],
    fetchImpl: mockFetch(jwk),
    now,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad_signature');
});
