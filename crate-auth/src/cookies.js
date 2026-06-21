// Cookie helpers.

/**
 * Decode a cookie value, tolerating malformed percent-encoding.
 * Other apps on a shared parent domain (e.g. Authelia/mycelium on
 * .mycelium-network.io) may set cookie values that are not valid
 * URI-encodings; decodeURIComponent throws on those. We must never let an
 * unrelated cookie crash forwardAuth, so fall back to the raw value.
 */
function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Parse a Cookie header into a {name: value} map. */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = safeDecode(value);
  }
  return out;
}

/**
 * Build a Set-Cookie header value with the contract's attributes:
 * httpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<ttl>.
 */
export function buildSetCookie(name, value, { maxAgeSeconds } = {}) {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ];
  if (typeof maxAgeSeconds === 'number') {
    attrs.push(`Max-Age=${maxAgeSeconds}`);
  }
  return attrs.join('; ');
}

/** Build a Set-Cookie that immediately expires the named cookie. */
export function buildClearCookie(name) {
  return [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
}
