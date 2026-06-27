// crate-auth: generic OAuth2/OIDC front door + self-signed session minter.
//
// Endpoints (see .claude/swarm/contract.md):
//   GET  /auth/login              Redirect to authorization_endpoint (standard mode only)
//   GET  /auth/callback?code=...  exchange code -> verify JWT -> set session -> 302 /
//   GET  /auth/verify             forwardAuth target: 200 if session else 401 + decoy
//                                 In AUTH_LOCAL_OPEN mode: always 200 (no session needed)
//   POST /auth/konami             validate sequence -> set session -> 200
//   GET  /auth/logout             clear cookie -> 302 /
//   GET  /health                  200 (bypasses forwardAuth)
//
// AUTH_FLOW_MODE:
//   "tap-initiated" (default): mycelium behavior preserved; no state/PKCE required.
//   "standard": /auth/login initiation; state + PKCE enforced on callback.
//
// AUTH_LOCAL_OPEN=true:
//   Boot without provider credentials. /auth/verify always returns 200.
//   SESSION_HMAC_KEY is auto-generated ephemerally if unset.
//   FOR LOCAL DEVELOPMENT ONLY.

import http from 'node:http';
import crypto from 'node:crypto';
import { config, assertConfig, applyDiscovery, localOpen } from './config.js';
import { signSession, verifySession } from './session.js';
import { matchKonami } from './konami.js';
import { verifyJwt, verifyMyceliumJwt } from './jwks.js';
import { exchangeCode } from './oauth.js';
import { decoyHtml } from './decoy.js';
import { parseCookies, buildSetCookie, buildClearCookie } from './cookies.js';
import { fetchDiscovery } from './discovery.js';
import {
  generateState,
  generateCodeVerifier,
  deriveCodeChallenge,
  safeEqual,
  signStateCookie,
  verifyStateCookie,
} from './pkce.js';

const SESSION_MAX_AGE = () => Math.round(config.sessionTtlDays * 24 * 60 * 60);
// State cookie is short-lived: 10 minutes.
const STATE_MAX_AGE = 600;

function log(...args) {
  // eslint-disable-next-line no-console
  console.log(`[crate-auth]`, ...args);
}

function sessionCookieHeader(subject) {
  const token = signSession({
    hmacKey: config.sessionHmacKey,
    ttlDays: config.sessionTtlDays,
    subject,
  });
  return buildSetCookie(config.cookieName, token, {
    maxAgeSeconds: SESSION_MAX_AGE(),
  });
}

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { Location: location, ...extraHeaders });
  res.end();
}

function sendDecoy(res) {
  const body = decoyHtml({ konamiSequence: config.konamiSequence });
  // Status 401 (not 502): Cloudflare replaces origin 5xx bodies with its own
  // branded error page, which would hide the decoy. 4xx is passed through
  // verbatim. Traefik forwardAuth still denies on any non-2xx, so the gate
  // holds. The body is still visually styled as a 502 Bad Gateway.
  res.writeHead(401, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// --- Route handlers ---------------------------------------------------------

/**
 * GET /auth/login — initiate authorization_code flow (standard mode only).
 * Generates state + PKCE, stores them in a signed short-lived cookie,
 * then redirects to the provider's authorization_endpoint.
 */
function handleLogin(req, res) {
  if (!config.authorizeUrl) {
    log('login: no authorizeUrl configured (tap-initiated mode?)');
    return sendDecoy(res);
  }

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = deriveCodeChallenge(codeVerifier);

  const stateCookieValue = signStateCookie({
    state,
    codeVerifier,
    hmacKey: config.sessionHmacKey,
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.oauthScopes,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const location = `${config.authorizeUrl}?${params.toString()}`;

  res.writeHead(302, {
    Location: location,
    'Set-Cookie': buildSetCookie(config.stateCookieName, stateCookieValue, {
      maxAgeSeconds: STATE_MAX_AGE,
    }),
  });
  res.end();
}

async function handleCallback(req, res, url) {
  const code = url.searchParams.get('code');
  if (!code) {
    log('callback: missing code');
    return sendDecoy(res);
  }

  let codeVerifier;

  if (config.authFlowMode === 'standard') {
    // Standard mode: require and validate state.
    const returnedState = url.searchParams.get('state');
    if (!returnedState) {
      log('callback: missing state (standard mode)');
      return sendDecoy(res);
    }

    const cookies = parseCookies(req.headers.cookie);
    const stateCookieRaw = cookies[config.stateCookieName];
    const stateResult = verifyStateCookie(stateCookieRaw, config.sessionHmacKey);

    if (!stateResult.valid) {
      log('callback: invalid state cookie:', stateResult.reason);
      return sendDecoy(res);
    }

    // Constant-time state comparison.
    if (!safeEqual(returnedState, stateResult.state)) {
      log('callback: state mismatch');
      return sendDecoy(res);
    }

    codeVerifier = stateResult.codeVerifier;
  }
  // tap-initiated mode: skip state/PKCE checks entirely (current behavior).

  const exchange = await exchangeCode({
    tokenUrl: config.tokenUrl,
    code,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    codeVerifier, // undefined in tap-initiated mode
  });
  if (!exchange.ok) {
    log('callback: token exchange failed:', exchange.error);
    return sendDecoy(res);
  }

  const verdict = await verifyJwt(exchange.accessToken, {
    jwksUrl: config.jwksUrl,
    fallbackTtlSeconds: config.jwksCacheTtlSeconds,
    expectedIssuer: config.oidcIssuer || config.jwtIssuer,
    expectedAudience: config.clientId,
    allowedAlgs: config.allowedAlgs,
  });
  if (!verdict.valid) {
    log('callback: JWT validation failed:', verdict.reason);
    return sendDecoy(res);
  }

  const subject = verdict.claims.sub || verdict.claims.session_id || 'crate';
  log('callback: session granted for', subject);

  const extraHeaders = { 'Set-Cookie': sessionCookieHeader(subject) };
  // Clear the state cookie after successful auth (standard mode).
  if (config.authFlowMode === 'standard') {
    extraHeaders['Set-Cookie'] = [
      sessionCookieHeader(subject),
      buildClearCookie(config.stateCookieName),
    ];
  }

  return redirect(res, config.appOrigin || '/', extraHeaders);
}

function handleVerify(req, res) {
  // LOCAL OPEN MODE: grant access unconditionally for local dev.
  if (localOpen) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[config.cookieName];
  const verdict = verifySession(token, { hmacKey: config.sessionHmacKey });
  if (verdict.valid) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  // No / invalid session -> decoy (401; Traefik relays this body+status).
  return sendDecoy(res);
}

async function handleKonami(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch {
    res.writeHead(413).end();
    return;
  }
  let submitted;
  try {
    const parsed = JSON.parse(body || '{}');
    submitted = parsed.sequence;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false }));
    return;
  }

  if (!matchKonami(submitted, config.konamiSequence)) {
    // Generic failure; do not reveal the expected sequence.
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false }));
    return;
  }

  log('konami: backdoor session granted');
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': sessionCookieHeader('konami'),
  });
  res.end(JSON.stringify({ ok: true }));
}

function handleLogout(req, res) {
  return redirect(res, config.appOrigin || '/', {
    'Set-Cookie': buildClearCookie(config.cookieName),
  });
}

// --- Router -----------------------------------------------------------------

export async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  const method = req.method || 'GET';

  try {
    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (pathname === '/auth/login' && method === 'GET') {
      return handleLogin(req, res);
    }
    if (pathname === '/auth/callback' && method === 'GET') {
      return await handleCallback(req, res, url);
    }
    if (pathname === '/auth/verify' && method === 'GET') {
      return handleVerify(req, res);
    }
    if (pathname === '/auth/konami' && method === 'POST') {
      return await handleKonami(req, res);
    }
    if (pathname === '/auth/logout' && method === 'GET') {
      return handleLogout(req, res);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  } catch (err) {
    log('unhandled error:', err && err.stack ? err.stack : err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('internal error');
    } else {
      res.end();
    }
  }
}

export function createServer() {
  return http.createServer((req, res) => {
    route(req, res);
  });
}

// Boot when run directly (not when imported by tests).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  // LOCAL OPEN MODE: generate an ephemeral dev session key if SESSION_HMAC_KEY
  // is not set. This allows the gated stack to function locally without any
  // operator-provided secrets. Sessions are lost on restart (intended).
  if (localOpen && !config.sessionHmacKey) {
    config.sessionHmacKey = crypto.randomBytes(32).toString('hex');
    log('WARNING: AUTH_LOCAL_OPEN=true and SESSION_HMAC_KEY is unset.');
    log('WARNING: Generated an ephemeral dev session key — sessions will not');
    log('WARNING: survive a container restart. Set SESSION_HMAC_KEY to persist.');
  }

  assertConfig();
  // Attempt OIDC discovery at boot; apply results to config before serving.
  const bootDiscovery = config.oidcIssuer
    ? fetchDiscovery(config.oidcIssuer).then((doc) => {
        if (doc) {
          applyDiscovery(doc);
          log('OIDC discovery applied from', config.oidcIssuer);
        } else {
          log('OIDC discovery unavailable; using explicit/alias endpoints');
        }
      }).catch((err) => {
        log('OIDC discovery error (non-fatal):', err.message);
      })
    : Promise.resolve();

  bootDiscovery.then(() => {
    const server = createServer();
    server.listen(config.port, () => {
      if (localOpen) {
        log(`listening on :${config.port} (mode=local-open — ALL REQUESTS GRANTED)`);
      } else {
        log(`listening on :${config.port} (mode=${config.authFlowMode})`);
      }
    });
  });
}
