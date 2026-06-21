// crate-auth: mycelium OAuth front door + self-signed session minter.
//
// Endpoints (see .claude/swarm/contract.md):
//   GET  /auth/callback?code=...  exchange code -> verify JWT -> set session -> 302 /
//   GET  /auth/verify             forwardAuth target: 200 if session else 502 + decoy
//   POST /auth/konami             validate sequence -> set session -> 200
//   GET  /auth/logout             clear cookie -> 302 /
//   GET  /health                  200 (bypasses forwardAuth)

import http from 'node:http';
import { config, assertConfig } from './config.js';
import { signSession, verifySession } from './session.js';
import { matchKonami } from './konami.js';
import { verifyMyceliumJwt } from './jwks.js';
import { exchangeCode } from './oauth.js';
import { decoyHtml } from './decoy.js';
import { parseCookies, buildSetCookie, buildClearCookie } from './cookies.js';

const SESSION_MAX_AGE = () => Math.round(config.sessionTtlDays * 24 * 60 * 60);

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
  res.writeHead(502, {
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

async function handleCallback(req, res, url) {
  const code = url.searchParams.get('code');
  if (!code) {
    log('callback: missing code');
    return sendDecoy(res);
  }

  const exchange = await exchangeCode({
    tokenUrl: config.tokenUrl,
    code,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
  });
  if (!exchange.ok) {
    log('callback: token exchange failed:', exchange.error);
    return sendDecoy(res);
  }

  const verdict = await verifyMyceliumJwt(exchange.accessToken, {
    jwksUrl: config.jwksUrl,
    fallbackTtlSeconds: config.jwksCacheTtlSeconds,
    expectedIssuer: config.jwtIssuer,
    expectedAudience: config.clientId,
  });
  if (!verdict.valid) {
    log('callback: JWT validation failed:', verdict.reason);
    return sendDecoy(res);
  }

  const subject = verdict.claims.sub || verdict.claims.session_id || 'crate';
  log('callback: session granted for', subject);
  return redirect(res, config.appOrigin || '/', {
    'Set-Cookie': sessionCookieHeader(subject),
  });
}

function handleVerify(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[config.cookieName];
  const verdict = verifySession(token, { hmacKey: config.sessionHmacKey });
  if (verdict.valid) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  // No / invalid session -> decoy 502 (Traefik relays this body+status).
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
  assertConfig();
  const server = createServer();
  server.listen(config.port, () => {
    log(`listening on :${config.port}`);
  });
}
