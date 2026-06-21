import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies } from '../src/cookies.js';

test('parses a simple cookie header into a map', () => {
  const out = parseCookies('crate_session=abc.def; other=1');
  assert.equal(out.crate_session, 'abc.def');
  assert.equal(out.other, '1');
});

test('url-decodes encoded cookie values', () => {
  const out = parseCookies('k=a%20b');
  assert.equal(out.k, 'a b');
});

test('does not throw on malformed percent-encoding from a foreign cookie', () => {
  // Authelia/mycelium on a shared parent domain can set values that are not
  // valid URI-encodings (a lone % here). parseCookies must not crash so that
  // forwardAuth keeps working and our own cookie is still readable.
  let out;
  assert.doesNotThrow(() => {
    out = parseCookies('authelia_session=50%; crate_session=good.token');
  });
  assert.equal(out.crate_session, 'good.token');
  assert.equal(out.authelia_session, '50%'); // falls back to the raw value
});

test('returns an empty map for a missing header', () => {
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(''), {});
});
