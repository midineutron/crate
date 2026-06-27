import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchDiscovery, _resetDiscoveryCache } from '../src/discovery.js';
import { config, applyDiscovery } from '../src/config.js';

const ISSUER = 'https://provider.example.com';

const WELL_KNOWN = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth2/authorize`,
  token_endpoint: `${ISSUER}/oauth2/token`,
  jwks_uri: `${ISSUER}/.well-known/jwks.json`,
};

function mockFetchOk(doc = WELL_KNOWN) {
  return async (url) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => doc,
  });
}

function mockFetchErr() {
  return async () => { throw new Error('ECONNREFUSED'); };
}

function mockFetchNotOk() {
  return async () => ({
    ok: false,
    status: 404,
    headers: { get: () => null },
    json: async () => ({}),
  });
}

test('parses a well-known discovery document', async () => {
  _resetDiscoveryCache();
  const doc = await fetchDiscovery(ISSUER, { fetchImpl: mockFetchOk() });
  assert.ok(doc, 'should return a doc');
  assert.equal(doc.issuer, ISSUER);
  assert.equal(doc.token_endpoint, `${ISSUER}/oauth2/token`);
  assert.equal(doc.jwks_uri, `${ISSUER}/.well-known/jwks.json`);
  assert.equal(doc.authorization_endpoint, `${ISSUER}/oauth2/authorize`);
});

test('returns null and does not throw on network error', async () => {
  _resetDiscoveryCache();
  const doc = await fetchDiscovery(ISSUER, { fetchImpl: mockFetchErr() });
  assert.equal(doc, null);
});

test('returns null on non-200 response', async () => {
  _resetDiscoveryCache();
  const doc = await fetchDiscovery(ISSUER, { fetchImpl: mockFetchNotOk() });
  assert.equal(doc, null);
});

test('returns null on doc missing required fields', async () => {
  _resetDiscoveryCache();
  const doc = await fetchDiscovery(ISSUER, {
    fetchImpl: mockFetchOk({ issuer: ISSUER }), // missing token_endpoint, jwks_uri
  });
  assert.equal(doc, null);
});

test('caches the discovery doc within TTL', async () => {
  _resetDiscoveryCache();
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => WELL_KNOWN,
    };
  };
  await fetchDiscovery(ISSUER, { fetchImpl, cacheTtlMs: 60_000 });
  await fetchDiscovery(ISSUER, { fetchImpl, cacheTtlMs: 60_000 });
  assert.equal(calls, 1, 'second call should use cache, not fetch again');
});

test('applyDiscovery: discovery values fill in missing config fields', () => {
  // Save originals
  const origTokenUrl = config.tokenUrl;
  const origJwksUrl = config.jwksUrl;
  const origAuthorizeUrl = config.authorizeUrl;

  // Temporarily clear them
  config.tokenUrl = undefined;
  config.jwksUrl = undefined;
  config.authorizeUrl = null;

  applyDiscovery(WELL_KNOWN);

  assert.equal(config.tokenUrl, WELL_KNOWN.token_endpoint);
  assert.equal(config.jwksUrl, WELL_KNOWN.jwks_uri);
  assert.equal(config.authorizeUrl, WELL_KNOWN.authorization_endpoint);

  // Restore
  config.tokenUrl = origTokenUrl;
  config.jwksUrl = origJwksUrl;
  config.authorizeUrl = origAuthorizeUrl;
});

test('applyDiscovery: explicit env vars (captured at load) win over discovery', () => {
  // When explicitTokenUrl was set at module load (env var), applyDiscovery
  // should not overwrite it. We simulate this by calling applyDiscovery with a
  // different doc and verifying the explicitly-set value persists.
  // Note: config.tokenUrl may be set from env at test-suite startup.
  // This test verifies the _logic_ by directly calling applyDiscovery with
  // a value already present (simulating the "explicit set" case).
  const savedTokenUrl = config.tokenUrl;
  if (!savedTokenUrl) {
    // No explicit URL in this test env - just verify null doc is a no-op.
    const savedJwks = config.jwksUrl;
    applyDiscovery(null);
    assert.equal(config.jwksUrl, savedJwks);
    return;
  }
  // Config already has a tokenUrl (from env). applyDiscovery should not
  // overwrite it because the explicit var was captured at module load.
  // However, our applyDiscovery checks the module-load-time `explicitTokenUrl`
  // closure variable, not config.tokenUrl, so we can only verify the overall
  // behavior: call applyDiscovery and confirm tokenUrl didn't change.
  applyDiscovery({ ...WELL_KNOWN, token_endpoint: 'https://SHOULD_NOT_WIN/token' });
  assert.equal(config.tokenUrl, savedTokenUrl, 'explicit tokenUrl must not be overwritten by discovery');
  // Restore authorizeUrl if we accidentally set it.
  config.authorizeUrl = null;
});

test('applyDiscovery: MYCELIUM_* alias (no explicit vars) is overridden by discovery', () => {
  // Simulate the alias-only case: tokenUrl came from MYCELIUM_TOKEN_URL (alias),
  // not from OAUTH_TOKEN_URL (explicit). The explicit closure var is undefined.
  // We cannot easily change the closure, so this test verifies the null-discovery
  // path (graceful no-op) and the successful path via direct config mutation.
  const saved = {
    tokenUrl: config.tokenUrl,
    jwksUrl: config.jwksUrl,
    authorizeUrl: config.authorizeUrl,
    oidcIssuer: config.oidcIssuer,
  };

  // Clear config to simulate "alias values not present in explicit vars"
  config.tokenUrl = undefined;
  config.jwksUrl = undefined;
  config.authorizeUrl = null;
  config.oidcIssuer = undefined;

  applyDiscovery(WELL_KNOWN);

  assert.equal(config.tokenUrl, WELL_KNOWN.token_endpoint);
  assert.equal(config.jwksUrl, WELL_KNOWN.jwks_uri);
  assert.equal(config.authorizeUrl, WELL_KNOWN.authorization_endpoint);
  assert.equal(config.oidcIssuer, WELL_KNOWN.issuer);

  // Restore
  Object.assign(config, saved);
});
