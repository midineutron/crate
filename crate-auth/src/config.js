// Centralized configuration sourced from environment variables.
// See .claude/swarm/contract.md for the canonical list.
//
// Precedence for endpoint resolution (highest to lowest):
//   1. Explicit OAUTH_* / OIDC_ISSUER env vars
//   2. OIDC discovery (auto-fetched when OIDC_ISSUER is set)
//   3. Legacy MYCELIUM_* / JWT_ISSUER aliases
//
// AUTH_FLOW_MODE:
//   "tap-initiated" (default): current mycelium behavior - callback works without
//     prior state cookie, no PKCE required. Active when only MYCELIUM_* vars are
//     set or AUTH_FLOW_MODE=tap-initiated is explicit.
//   "standard": enforces state + PKCE. Active when OIDC_ISSUER or
//     OAUTH_AUTHORIZE_URL is set (unless overridden back to tap-initiated).
//
// AUTH_LOCAL_OPEN:
//   When "true", boot without any provider credentials. /auth/verify always
//   returns 200. SESSION_HMAC_KEY is auto-generated if absent. For local Docker
//   Desktop development ONLY — never set in production.

function env(name) {
  const v = process.env[name];
  return v === undefined || v === '' ? undefined : v;
}

// --- Resolve endpoints with precedence: explicit > alias ---
// Discovery (OIDC_ISSUER) is applied at runtime in loadDiscovery(); config
// values here capture only what's in env at module-load time.

const explicitTokenUrl = env('OAUTH_TOKEN_URL');
const explicitJwksUrl = env('OAUTH_JWKS_URL');
const explicitAuthorizeUrl = env('OAUTH_AUTHORIZE_URL');
const explicitIssuer = env('OIDC_ISSUER');

// Fallback to MYCELIUM_* aliases (back-compat).
const aliasTokenUrl = env('MYCELIUM_TOKEN_URL');
const aliasJwksUrl = env('MYCELIUM_JWKS_URL');
const aliasJwtIssuer = env('JWT_ISSUER');

// Determine flow mode.
// If explicit standard-mode triggers exist and AUTH_FLOW_MODE is not explicitly
// set to tap-initiated, default to standard.
function resolveFlowMode() {
  const explicit = env('AUTH_FLOW_MODE');
  if (explicit === 'tap-initiated') return 'tap-initiated';
  if (explicit === 'standard') return 'standard';
  // Auto-detect: if OIDC_ISSUER or OAUTH_AUTHORIZE_URL is present, default standard.
  if (explicitIssuer || explicitAuthorizeUrl) return 'standard';
  // Legacy MYCELIUM_* only -> tap-initiated.
  return 'tap-initiated';
}

export const config = {
  port: parseInt(process.env.PORT || '9090', 10),

  // Resolved OAuth endpoints (may be overridden by discovery at boot).
  // tokenUrl / jwksUrl are required; authorizeUrl only needed for standard mode.
  tokenUrl: explicitTokenUrl || aliasTokenUrl,
  jwksUrl: explicitJwksUrl || aliasJwksUrl,
  authorizeUrl: explicitAuthorizeUrl || null,

  // OIDC issuer (for discovery and JWT iss validation).
  oidcIssuer: explicitIssuer || aliasJwtIssuer,

  // Back-compat: the original JWT_ISSUER alias (used in server.js as expectedIssuer).
  jwtIssuer: aliasJwtIssuer,

  // OAuth scopes for /auth/login redirect.
  oauthScopes: env('OAUTH_SCOPES') || 'openid',

  // OAuth client credentials (client_secret_post).
  clientId: env('OAUTH_CLIENT_ID'),
  clientSecret: env('OAUTH_CLIENT_SECRET'),
  redirectUri: env('REDIRECT_URI'),

  // Provider / flow mode.
  authFlowMode: resolveFlowMode(),

  // Allowed JWT signing algorithms (comma-separated).
  allowedAlgs: (env('OAUTH_ALLOWED_ALGS') || 'ES256,RS256')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean),

  // Self-signed session.
  sessionHmacKey: env('SESSION_HMAC_KEY'),
  sessionTtlDays: parseInt(process.env.SESSION_TTL_DAYS || '30', 10),
  cookieName: process.env.SESSION_COOKIE_NAME || 'crate_session',

  // Konami entry sequence.
  konamiSequence: (process.env.KONAMI_SEQUENCE ||
    'up,up,down,down,left,right,left,right,b,a'),

  // Application origin (https://<host>) used for redirects.
  appOrigin: env('APP_ORIGIN') || '',

  // JWKS cache TTL fallback (seconds) when no Cache-Control max-age is present.
  jwksCacheTtlSeconds: parseInt(process.env.JWKS_CACHE_TTL_SECONDS || '3600', 10),

  // State cookie name (short-lived; different from session cookie).
  stateCookieName: process.env.STATE_COOKIE_NAME || 'crate_state',
};

/**
 * Apply discovery document values where explicit env vars are absent.
 * Called at server boot after fetchDiscovery resolves.
 * Explicit env vars always win over discovery.
 *
 * @param {object} doc - parsed openid-configuration doc
 */
export function applyDiscovery(doc) {
  if (!doc) return;
  if (!explicitTokenUrl && doc.token_endpoint) {
    config.tokenUrl = doc.token_endpoint;
  }
  if (!explicitJwksUrl && doc.jwks_uri) {
    config.jwksUrl = doc.jwks_uri;
  }
  if (!explicitAuthorizeUrl && doc.authorization_endpoint) {
    config.authorizeUrl = doc.authorization_endpoint;
  }
  // Prefer discovery issuer over alias for JWT iss validation.
  if (!explicitIssuer && doc.issuer) {
    config.oidcIssuer = doc.issuer;
  }
}

// Local/open mode flag. When AUTH_LOCAL_OPEN=true the server boots without any
// provider credentials and /auth/verify always returns 200. This is ONLY for
// local Docker Desktop development; production must never set this flag.
export const localOpen = (env('AUTH_LOCAL_OPEN') || '').toLowerCase() === 'true';

// Fail fast on missing critical secrets (skip when running unit tests, which
// import individual modules directly rather than booting the server).
export function assertConfig() {
  if (localOpen) {
    // Local mode: no provider vars required. SESSION_HMAC_KEY is generated
    // ephemerally at boot if absent (handled in server.js boot section).
    return;
  }
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
