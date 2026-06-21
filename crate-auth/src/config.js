// Centralized configuration sourced from environment variables.
// See .claude/swarm/contract.md for the canonical list.

function required(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    return undefined;
  }
  return v;
}

export const config = {
  port: parseInt(process.env.PORT || '9090', 10),

  // mycelium endpoints (in-cluster service DNS)
  tokenUrl: required('MYCELIUM_TOKEN_URL'),
  jwksUrl: required('MYCELIUM_JWKS_URL'),

  // OAuth client credentials (client_secret_post)
  clientId: required('OAUTH_CLIENT_ID'),
  clientSecret: required('OAUTH_CLIENT_SECRET'),
  redirectUri: required('REDIRECT_URI'),

  // Expected JWT issuer (iss) from mycelium. Optional; if unset, iss is not checked.
  jwtIssuer: required('JWT_ISSUER'),

  // Self-signed session
  sessionHmacKey: required('SESSION_HMAC_KEY'),
  sessionTtlDays: parseInt(process.env.SESSION_TTL_DAYS || '30', 10),
  cookieName: process.env.SESSION_COOKIE_NAME || 'crate_session',

  // Konami entry sequence
  konamiSequence: (process.env.KONAMI_SEQUENCE ||
    'up,up,down,down,left,right,left,right,b,a'),

  // Application origin (https://<host>) used for redirects
  appOrigin: required('APP_ORIGIN', ''),

  // JWKS cache TTL fallback (seconds) when no Cache-Control max-age is present
  jwksCacheTtlSeconds: parseInt(process.env.JWKS_CACHE_TTL_SECONDS || '3600', 10),
};

// Fail fast on missing critical secrets (skip when running unit tests, which
// import individual modules directly rather than booting the server).
export function assertConfig() {
  const missing = [];
  for (const key of [
    'tokenUrl',
    'jwksUrl',
    'clientId',
    'clientSecret',
    'redirectUri',
    'sessionHmacKey',
  ]) {
    if (!config[key]) missing.push(key);
  }
  if (missing.length) {
    throw new Error(
      `crate-auth: missing required configuration: ${missing.join(', ')}`,
    );
  }
}
