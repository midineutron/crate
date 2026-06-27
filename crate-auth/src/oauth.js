// OAuth2 token exchange.
//
// Confirmed from mycelium oauth/handlers.go ExchangeToken:
//   POST <token_url>  (application/x-www-form-urlencoded)
//   fields: grant_type=authorization_code, code, client_id, client_secret,
//           redirect_uri, [code_verifier for PKCE]
//   client auth: client_secret_post (credentials in the form body, NOT Basic).
//   success response (200): { access_token, token_type: "Bearer", expires_in }
//   the access_token is a JWT (ES256 for mycelium, RS256 for some OIDC providers)

/**
 * Exchange an authorization code for an access token (JWT).
 *
 * @param {object} opts
 * @param {string}    opts.tokenUrl
 * @param {string}    opts.code
 * @param {string}    opts.clientId
 * @param {string}    opts.clientSecret
 * @param {string}    [opts.redirectUri]
 * @param {string}    [opts.codeVerifier] - PKCE code_verifier (standard mode)
 * @param {function}  [opts.fetchImpl=fetch]
 * @returns {Promise<{ok: boolean, accessToken?: string, status?: number, error?: string}>}
 */
export async function exchangeCode({
  tokenUrl,
  code,
  clientId,
  clientSecret,
  redirectUri,
  codeVerifier,
  fetchImpl = fetch,
}) {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (redirectUri) form.set('redirect_uri', redirectUri);
  // PKCE: include code_verifier when provided (standard mode).
  if (codeVerifier) form.set('code_verifier', codeVerifier);

  let res;
  try {
    res = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: form.toString(),
    });
  } catch (err) {
    return { ok: false, error: `network:${err.message}` };
  }

  let body = {};
  try {
    body = await res.json();
  } catch {
    // non-JSON body; leave body empty
  }

  if (!res.ok) {
    const detail = body.error_description || body.error || `HTTP ${res.status}`;
    return { ok: false, status: res.status, error: detail };
  }
  if (!body.access_token) {
    return { ok: false, status: res.status, error: 'no_access_token' };
  }
  return { ok: true, accessToken: body.access_token };
}
