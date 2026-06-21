import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession } from '../src/session.js';

const KEY = 'test-hmac-key-at-least-32-bytes-long-xxxxx';

test('sign then verify round-trips a valid session', () => {
  const token = signSession({ hmacKey: KEY, ttlDays: 30, subject: 'tag-123' });
  const result = verifySession(token, { hmacKey: KEY });
  assert.equal(result.valid, true);
  assert.equal(result.payload.sub, 'tag-123');
  assert.ok(result.payload.exp > result.payload.iat);
});

test('verify rejects a tampered payload', () => {
  const token = signSession({ hmacKey: KEY, ttlDays: 30 });
  const [, sig] = token.split('.');
  const forgedPayload = Buffer.from(
    JSON.stringify({ sub: 'attacker', iat: 0, exp: 9999999999 }),
  ).toString('base64url');
  const forged = `${forgedPayload}.${sig}`;
  const result = verifySession(forged, { hmacKey: KEY });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad_signature');
});

test('verify rejects a token signed with a different key', () => {
  const token = signSession({ hmacKey: KEY, ttlDays: 30 });
  const result = verifySession(token, { hmacKey: 'a-totally-different-key' });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad_signature');
});

test('verify rejects an expired session', () => {
  // Issue at a fixed point and verify well after expiry.
  const issuedAt = 1_000_000;
  const token = signSession({ hmacKey: KEY, ttlDays: 1, subject: 'x', now: issuedAt });
  const result = verifySession(token, {
    hmacKey: KEY,
    now: issuedAt + 2 * 24 * 60 * 60,
  });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'expired');
});

test('verify rejects missing/malformed tokens', () => {
  assert.equal(verifySession(undefined, { hmacKey: KEY }).reason, 'missing');
  assert.equal(verifySession('nodot', { hmacKey: KEY }).reason, 'malformed');
});
