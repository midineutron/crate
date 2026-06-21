import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyMyceliumJwt, _resetCache } from '../src/jwks.js';

const KID = 'test-key-1';
const ISSUER = 'https://mycelium.example';
const AUDIENCE = 'crate-client-id';

// Generate an EC P-256 key pair mirroring mycelium's ES256 signing.
function makeKeypair() {
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
function signJwt(claims, privateKey) {
  const header = { alg: 'ES256', kid: KID, typ: 'JWT' };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  });
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

test('accepts a valid mycelium-style ES256 JWT', async () => {
  _resetCache();
  const { privateKey, jwk } = makeKeypair();
  const now = 1_700_000_000;
  const token = signJwt(
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
  const { privateKey, jwk } = makeKeypair();
  const now = 1_700_000_000;
  const token = signJwt(
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
  const { privateKey, jwk } = makeKeypair();
  const now = 1_700_000_000;
  const token = signJwt(
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
  const { privateKey, jwk } = makeKeypair();
  const now = 1_700_000_000;
  const token = signJwt({ iss: ISSUER, aud: [AUDIENCE], sub: 's', iat: now - 7200, exp: now - 3600 }, privateKey);
  const result = await verifyMyceliumJwt(token, {
    jwksUrl: 'http://jwks',
    fetchImpl: mockFetch(jwk),
    now,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'expired');
});
