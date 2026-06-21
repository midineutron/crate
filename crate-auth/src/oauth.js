// OAuth2 token exchange against mycelium.
//
// Confirmed from mycelium oauth/handlers.go ExchangeToken:
//   POST <MYCELIUM_TOKEN_URL>  (application/x-www-form-urlencoded)
//   fields: grant_type=authorization_code, code, client_id, client_secret,
//           redirect_uri
//   client auth: client_secret_post (credentials in the form body, NOT Basic).
//   success response (200): { access_token, token_type: "Bearer", expires_in }
//   the access_token is an ES256 JWT (proof-of-tap) with aud=client_id.

/**
 * Exchange an authorization code for a mycelium access token (JWT).
 * @returns {Promise<{ok: boolean, accessToken?: string, status?: number, error?: string}>}
 */
export async function exchangeCode({
  tokenUrl,
  code,
  clientId,
  clientSecret,
  redirectUri,
  fetchImpl = fetch,
}) {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (redirectUri) form.set('redirect_uri', redirectUri);

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
