# crate-auth

Generic OAuth2/OIDC relying party and self-signed session minter for Crate.
Exchanges an authorization code for an access token (JWT), validates the JWT
against the provider's JWKS, and mints a 30-day self-signed HMAC session cookie.
Traefik's `forwardAuth` middleware calls `/auth/verify` on every request;
unauthenticated requests get a decoy `502 Bad Gateway` page (with a hidden
konami-code backdoor).

Zero runtime dependencies — only Node 20 built-ins (`http`, `crypto`).

---

## Providers

### mycelium (tap-initiated, ES256)

The original deployment mode. A mycelium NFC tap initiates the flow directly at
`/auth/callback` without a prior `/auth/login` redirect. No `state` or PKCE is
required. The access token is an ES256 JWT (IEEE-P1363 R‖S signature).

Configure with `MYCELIUM_TOKEN_URL` + `MYCELIUM_JWKS_URL` (legacy aliases still
fully supported) or the new `OAUTH_TOKEN_URL` + `OAUTH_JWKS_URL`. `AUTH_FLOW_MODE`
defaults to `tap-initiated` when no `OIDC_ISSUER` / `OAUTH_AUTHORIZE_URL` is set.

### Generic OIDC (standard, discovery, RS256/ES256)

Any compliant OIDC provider (Keycloak, Google, Auth0, etc.). Set `OIDC_ISSUER` and
crate-auth fetches `${OIDC_ISSUER}/.well-known/openid-configuration` at boot to
derive `token_endpoint`, `jwks_uri`, and `authorization_endpoint`. `AUTH_FLOW_MODE`
auto-sets to `standard` (state + S256 PKCE enforced).

Supports both ES256 (EC P-256) and RS256 (RSA) JWT signatures. The allowlist is
configurable via `OAUTH_ALLOWED_ALGS`.

---

## Endpoints (`:9090`)

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/auth/login` | Standard mode only. Redirect to `authorization_endpoint` with `state`, `code_challenge` (S256), and `scope`. Sets a 10-min signed state cookie. |
| `GET` | `/auth/callback` | Exchange `?code` for JWT, validate, set `crate_session`, 302 to `APP_ORIGIN`. Standard mode also validates `state` and sends `code_verifier`. Failures render the decoy 502. |
| `GET` | `/auth/verify` | forwardAuth target. 200 if valid HMAC session cookie present, else 401 + decoy HTML. |
| `POST` | `/auth/konami` | Body `{"sequence":[...]}`. On match against `KONAMI_SEQUENCE`, set session, 200; else 401. |
| `GET` | `/auth/logout` | Clear cookie, 302 to `APP_ORIGIN`. |
| `GET` | `/health` | 200 (bypasses forwardAuth). |

---

## Session cookie

`crate_session` = `base64url(JSON {sub,iat,exp})` + `.` + `base64url(HMAC-SHA256)`.
Verification recomputes the HMAC (constant-time) and checks `exp`. Single key:
`SESSION_HMAC_KEY`. Cookie attrs: `HttpOnly; Secure; SameSite=Lax; Path=/;
Max-Age=<SESSION_TTL_DAYS days>`.

---

## Environment variables

See `.claude/swarm/contract.md` for the full canonical list with precedence rules.

### Quick reference

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `PORT` | no | `9090` | |
| `OAUTH_CLIENT_ID` | yes | — | Also expected JWT `aud` |
| `OAUTH_CLIENT_SECRET` | yes | — | |
| `REDIRECT_URI` | yes | — | `https://<host>/auth/callback` |
| `SESSION_HMAC_KEY` | yes | — | Random 32+ bytes |
| `OIDC_ISSUER` | no* | — | Triggers OIDC discovery; auto-sets `standard` flow mode |
| `OAUTH_TOKEN_URL` | no* | — | Explicit token endpoint (overrides discovery) |
| `OAUTH_JWKS_URL` | no* | — | Explicit JWKS endpoint (overrides discovery) |
| `OAUTH_AUTHORIZE_URL` | no* | — | Explicit authorize endpoint (overrides discovery) |
| `OAUTH_SCOPES` | no | `openid` | Scopes for `/auth/login` |
| `OAUTH_ALLOWED_ALGS` | no | `ES256,RS256` | JWT alg allowlist |
| `AUTH_FLOW_MODE` | no | auto | `tap-initiated` or `standard` |
| `MYCELIUM_TOKEN_URL` | no* | — | Back-compat alias for `OAUTH_TOKEN_URL` |
| `MYCELIUM_JWKS_URL` | no* | — | Back-compat alias for `OAUTH_JWKS_URL` |
| `JWT_ISSUER` | no | — | Back-compat alias for `OIDC_ISSUER` |
| `SESSION_TTL_DAYS` | no | `30` | |
| `SESSION_COOKIE_NAME` | no | `crate_session` | |
| `STATE_COOKIE_NAME` | no | `crate_state` | Short-lived state+PKCE cookie (standard mode) |
| `KONAMI_SEQUENCE` | no | `up,up,down,down,left,right,left,right,b,a` | |
| `APP_ORIGIN` | no | `''` | Redirect target after auth; falls back to `/` |
| `JWKS_CACHE_TTL_SECONDS` | no | `3600` | Fallback when JWKS has no `Cache-Control max-age` |

\* One of `OIDC_ISSUER`, `OAUTH_TOKEN_URL`/`OAUTH_JWKS_URL`, or `MYCELIUM_TOKEN_URL`/`MYCELIUM_JWKS_URL` must supply `tokenUrl` and `jwksUrl`.

---

## Run

```sh
node src/server.js     # or: npm start
npm test               # node --test (cookies, discovery, jwks/JWT, login, session, konami)
docker build -t ghcr.io/midineutron/crate-auth .
```

---

## mycelium token exchange (confirmed against mycelium `oauth/handlers.go`)

`POST <token_url>` form-encoded (`application/x-www-form-urlencoded`):
`grant_type=authorization_code`, `code`, `client_id`, `client_secret`,
`redirect_uri`, and (in standard mode) `code_verifier`. Client auth is
**client_secret_post** (credentials in the body, not HTTP Basic). Success returns
`{access_token, token_type, expires_in}` where `access_token` is an ES256 JWT
with `aud=client_id`, `iss=<issuer>`, and a `kid` header matching a key in the
JWKS. Signatures are raw IEEE-P1363 (R‖S), verified with `dsaEncoding: 'ieee-p1363'`.
