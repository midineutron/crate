// Tests for /auth/login initiation leg (standard mode) and callback
// standard-mode state+PKCE enforcement.
//
// These tests drive the route() handler directly without spawning a real server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { route } from '../src/server.js';
import { config } from '../src/config.js';
import { signStateCookie, deriveCodeChallenge } from '../src/pkce.js';
import { buildSetCookie } from '../src/cookies.js';
import { signSession } from '../src/session.js';

// ---- minimal request/response mock ----------------------------------------

function makeReq(method, path, { headers = {} } = {}) {
  const events = {};
  const req = {
    method,
    url: path,
    headers: { ...headers },
    on(ev, fn) { events[ev] = fn; return req; },
    destroy() {},
    _emit(ev, ...args) { if (events[ev]) events[ev](...args); },
  };
  // Immediately end the body for GET requests.
  Promise.resolve().then(() => req._emit('end'));
  return req;
}

function makeRes() {
  const res = {
    statusCode: null,
    headers: {},
    body: '',
    headersSent: false,
    writeHead(code, headers) {
      this.statusCode = code;
      if (headers) Object.assign(this.headers, headers);
      this.headersSent = true;
      return this;
    },
    end(body) {
      if (body) this.body += body;
      return this;
    },
  };
  return res;
}

// ---- shared test fixtures --------------------------------------------------

const HMAC_KEY = 'test-hmac-key-at-least-32-bytes-xxxxxxxxxxx';
const CLIENT_ID = 'test-client-id';
const REDIRECT_URI = 'https://crate.example.com/auth/callback';
const AUTHORIZE_URL = 'https://provider.example.com/oauth2/authorize';
const STATE_COOKIE = 'crate_state';

// Patch config for all tests.
const savedConfig = {};
function patchConfig(overrides) {
  for (const k of Object.keys(overrides)) savedConfig[k] = config[k];
  Object.assign(config, overrides);
}
function restoreConfig() {
  Object.assign(config, savedConfig);
}

// ============================================================
// /auth/login tests
// ============================================================

test('/auth/login redirects to authorization_endpoint with state and S256 code_challenge', async () => {
  patchConfig({
    authorizeUrl: AUTHORIZE_URL,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    oauthScopes: 'openid profile',
    sessionHmacKey: HMAC_KEY,
    stateCookieName: STATE_COOKIE,
    authFlowMode: 'standard',
  });

  const req = makeReq('GET', '/auth/login');
  const res = makeRes();
  await route(req, res);

  assert.equal(res.statusCode, 302, 'should redirect');

  const location = res.headers['Location'];
  assert.ok(location, 'Location header must be set');
  const url = new URL(location);
  assert.equal(url.origin + url.pathname, AUTHORIZE_URL);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(url.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const state = url.searchParams.get('state');
  assert.ok(state && state.length > 0, 'state must be present');
  const challenge = url.searchParams.get('code_challenge');
  assert.ok(challenge && challenge.length > 0, 'code_challenge must be present');

  // Verify the state cookie was set.
  const setCookieHeader = res.headers['Set-Cookie'];
  assert.ok(setCookieHeader, 'Set-Cookie header must be set');
  const cookieStr = Array.isArray(setCookieHeader) ? setCookieHeader.join('; ') : setCookieHeader;
  assert.ok(cookieStr.includes('crate_state='), 'state cookie name must appear');

  restoreConfig();
});

test('/auth/login returns decoy when authorizeUrl is not configured', async () => {
  patchConfig({
    authorizeUrl: null,
    sessionHmacKey: HMAC_KEY,
    konamiSequence: 'up,up,down,down,left,right,left,right,b,a',
  });

  const req = makeReq('GET', '/auth/login');
  const res = makeRes();
  await route(req, res);

  assert.equal(res.statusCode, 401);

  restoreConfig();
});

// ============================================================
// /auth/callback standard mode tests
// ============================================================

// Helper: build a valid state cookie with a known state + verifier.
function buildValidStateCookie(state, codeVerifier) {
  return signStateCookie({ state, codeVerifier, hmacKey: HMAC_KEY });
}

// Helper: a mock fetch factory for token exchange + JWKS.
// Returns a simple "no-op" - callback tests focus on state/PKCE validation,
// not the JWT verification leg. We make exchange fail intentionally to keep
// the test scope narrow (state validated first, then we confirm it proceeds).
function makeMockExchangeFetch(accessToken) {
  return async (url, opts) => {
    if (url.includes('token')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ access_token: accessToken || 'dummy' }),
      };
    }
    // JWKS fetch - return a key that won't match (test just needs to reach this point).
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'max-age=3600' },
      json: async () => ({ keys: [] }),
    };
  };
}

test('callback standard mode: missing state returns decoy', async () => {
  patchConfig({
    authFlowMode: 'standard',
    sessionHmacKey: HMAC_KEY,
    stateCookieName: STATE_COOKIE,
    konamiSequence: 'up,up,down,down,left,right,left,right,b,a',
    tokenUrl: 'https://provider.example.com/oauth2/token',
    jwksUrl: 'https://provider.example.com/.well-known/jwks.json',
    clientId: CLIENT_ID,
    clientSecret: 'secret',
    redirectUri: REDIRECT_URI,
    allowedAlgs: ['ES256', 'RS256'],
    jwksCacheTtlSeconds: 3600,
    oidcIssuer: null,
    jwtIssuer: null,
  });

  // No state param in URL; no state cookie.
  const req = makeReq('GET', '/auth/callback?code=someCode');
  const res = makeRes();
  await route(req, res);

  assert.equal(res.statusCode, 401, 'should serve decoy on missing state');

  restoreConfig();
});

test('callback standard mode: mismatched state returns decoy', async () => {
  patchConfig({
    authFlowMode: 'standard',
    sessionHmacKey: HMAC_KEY,
    stateCookieName: STATE_COOKIE,
    konamiSequence: 'up,up,down,down,left,right,left,right,b,a',
    tokenUrl: 'https://provider.example.com/oauth2/token',
    jwksUrl: 'https://provider.example.com/.well-known/jwks.json',
    clientId: CLIENT_ID,
    clientSecret: 'secret',
    redirectUri: REDIRECT_URI,
    allowedAlgs: ['ES256', 'RS256'],
    jwksCacheTtlSeconds: 3600,
    oidcIssuer: null,
    jwtIssuer: null,
  });

  const realState = 'correct-state-value';
  const verifier = 'test-code-verifier';
  const stateCookieValue = buildValidStateCookie(realState, verifier);
  const cookieHeader = `${STATE_COOKIE}=${encodeURIComponent(stateCookieValue)}`;

  // URL carries a DIFFERENT state than the cookie.
  const req = makeReq('GET', '/auth/callback?code=someCode&state=WRONG_STATE', {
    headers: { cookie: cookieHeader },
  });
  const res = makeRes();
  await route(req, res);

  assert.equal(res.statusCode, 401, 'should serve decoy on state mismatch');

  restoreConfig();
});

test('callback standard mode: valid state + verifier proceeds past state check', async () => {
  // This test uses a real ECDSA key pair to produce a valid JWT so we can
  // verify the full callback flow in standard mode (state OK -> exchange ->
  // JWT verify -> session).
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = 'test-cb-key';
  jwk.kid = kid;
  jwk.alg = 'ES256';

  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: 'https://provider.example.com', aud: [CLIENT_ID], sub: 'user-123', iat: now, exp: now + 3600 };
  const header = { alg: 'ES256', kid, typ: 'JWT' };
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  const accessToken = `${signingInput}.${sig.toString('base64url')}`;

  // Mock fetch: token exchange returns valid JWT; JWKS returns the matching key.
  const mockFetch = async (url) => {
    if (url.includes('token')) {
      return {
        ok: true, status: 200,
        headers: { get: () => null },
        json: async () => ({ access_token: accessToken }),
      };
    }
    return {
      ok: true, status: 200,
      headers: { get: () => 'max-age=3600' },
      json: async () => ({ keys: [jwk] }),
    };
  };

  // Temporarily inject mockFetch into the module by patching config endpoints
  // and using the route handler which calls the real modules. We need a way
  // to pass fetchImpl. Since route() uses module-level fetch, we stub global.fetch.
  const origFetch = global.fetch;
  global.fetch = mockFetch;

  patchConfig({
    authFlowMode: 'standard',
    sessionHmacKey: HMAC_KEY,
    stateCookieName: STATE_COOKIE,
    konamiSequence: 'up,up,down,down,left,right,left,right,b,a',
    tokenUrl: 'https://provider.example.com/oauth2/token',
    jwksUrl: 'https://provider.example.com/.well-known/jwks.json',
    clientId: CLIENT_ID,
    clientSecret: 'secret',
    redirectUri: REDIRECT_URI,
    allowedAlgs: ['ES256', 'RS256'],
    jwksCacheTtlSeconds: 3600,
    oidcIssuer: 'https://provider.example.com',
    jwtIssuer: null,
    appOrigin: 'https://crate.example.com',
    cookieName: 'crate_session',
    sessionTtlDays: 30,
  });

  // Reset JWKS cache so our mockFetch is used.
  const { _resetCache } = await import('../src/jwks.js');
  _resetCache();

  const state = 'my-test-state-value-abc123';
  const verifier = 'my-test-verifier-abcdef';
  const stateCookieValue = buildValidStateCookie(state, verifier);
  const cookieHeader = `${STATE_COOKIE}=${encodeURIComponent(stateCookieValue)}`;

  const req = makeReq('GET', `/auth/callback?code=someCode&state=${state}`, {
    headers: { cookie: cookieHeader },
  });
  const res = makeRes();
  await route(req, res);

  global.fetch = origFetch;
  restoreConfig();
  _resetCache();

  // Should redirect on success (not serve decoy).
  assert.equal(res.statusCode, 302, 'should redirect to app origin on success');
  const setCookie = res.headers['Set-Cookie'];
  assert.ok(Array.isArray(setCookie) ? setCookie.some(c => c.includes('crate_session')) : String(setCookie).includes('crate_session'), 'should set session cookie');
});

// ============================================================
// Tap-initiated mode: existing behavior unchanged (no state required)
// ============================================================

test('callback tap-initiated mode: proceeds without state cookie', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const kid = 'tap-key';
  jwk.kid = kid;
  jwk.alg = 'ES256';

  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: 'https://mycelium.example', aud: [CLIENT_ID], sub: 'tag-session', iat: now, exp: now + 3600 };
  const header = { alg: 'ES256', kid, typ: 'JWT' };
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  const accessToken = `${signingInput}.${sig.toString('base64url')}`;

  const mockFetch = async (url) => {
    if (url.includes('token')) {
      return {
        ok: true, status: 200,
        headers: { get: () => null },
        json: async () => ({ access_token: accessToken }),
      };
    }
    return {
      ok: true, status: 200,
      headers: { get: () => 'max-age=3600' },
      json: async () => ({ keys: [jwk] }),
    };
  };

  const origFetch = global.fetch;
  global.fetch = mockFetch;

  patchConfig({
    authFlowMode: 'tap-initiated',
    sessionHmacKey: HMAC_KEY,
    stateCookieName: STATE_COOKIE,
    konamiSequence: 'up,up,down,down,left,right,left,right,b,a',
    tokenUrl: 'https://mycelium.example/oauth/token',
    jwksUrl: 'https://mycelium.example/.well-known/jwks.json',
    clientId: CLIENT_ID,
    clientSecret: 'secret',
    redirectUri: REDIRECT_URI,
    allowedAlgs: ['ES256', 'RS256'],
    jwksCacheTtlSeconds: 3600,
    oidcIssuer: null,
    jwtIssuer: 'https://mycelium.example',
    appOrigin: 'https://crate.example.com',
    cookieName: 'crate_session',
    sessionTtlDays: 30,
  });

  const { _resetCache } = await import('../src/jwks.js');
  _resetCache();

  // No state param, no state cookie — should still work.
  const req = makeReq('GET', '/auth/callback?code=tapCode');
  const res = makeRes();
  await route(req, res);

  global.fetch = origFetch;
  restoreConfig();
  _resetCache();

  assert.equal(res.statusCode, 302, 'tap-initiated: should redirect on success without state');
  const setCookie = res.headers['Set-Cookie'];
  const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
  assert.ok(cookieStr.includes('crate_session'), 'should set session cookie');
});
