// OIDC provider discovery via /.well-known/openid-configuration.
//
// Usage:
//   const doc = await fetchDiscovery(issuerUrl, { fetchImpl });
//   // doc: { authorization_endpoint, token_endpoint, jwks_uri, issuer }
//
// Results are cached in-process for `cacheTtlMs` (default 1 hour).
// On fetch/parse failure, returns null so callers can fall back to explicit URLs.

let cachedDoc = null;
let cacheExpiresAt = 0;

/**
 * Fetch the OIDC discovery document for an issuer.
 * @param {string} issuer - e.g. "https://accounts.example.com"
 * @param {object} [opts]
 * @param {function} [opts.fetchImpl=fetch]
 * @param {number}  [opts.cacheTtlMs=3_600_000]
 * @returns {Promise<object|null>}
 */
export async function fetchDiscovery(issuer, { fetchImpl = fetch, cacheTtlMs = 3_600_000 } = {}) {
  const now = Date.now();
  if (cachedDoc && cacheExpiresAt > now) return cachedDoc;

  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  let res;
  try {
    res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    // Network error: return null, caller falls back to explicit config.
    return null;
  }

  if (!res.ok) return null;

  let doc;
  try {
    doc = await res.json();
  } catch {
    return null;
  }

  // Validate minimal required fields.
  if (
    typeof doc.issuer !== 'string' ||
    typeof doc.token_endpoint !== 'string' ||
    typeof doc.jwks_uri !== 'string'
  ) {
    return null;
  }

  cachedDoc = doc;
  cacheExpiresAt = now + cacheTtlMs;
  return doc;
}

/** Reset the in-process discovery cache (for tests). */
export function _resetDiscoveryCache() {
  cachedDoc = null;
  cacheExpiresAt = 0;
}
