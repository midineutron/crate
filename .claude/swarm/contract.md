# crate-auth Environment Variable Contract

Canonical list of environment variables consumed by `crate-auth`.

## Precedence for endpoint resolution

Highest to lowest:

1. **Explicit** `OAUTH_*` env vars
2. **OIDC discovery** — auto-fetched from `${OIDC_ISSUER}/.well-known/openid-configuration` at boot
3. **Legacy aliases** — `MYCELIUM_TOKEN_URL`, `MYCELIUM_JWKS_URL`, `JWT_ISSUER`

If a value is available at a higher precedence, lower-precedence sources are ignored.

---

## Variables

### Core OAuth2/OIDC (new canonical names)

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `OAUTH_CLIENT_ID` | yes | — | Client ID; also used as expected JWT `aud` |
| `OAUTH_CLIENT_SECRET` | yes | — | Client secret (client_secret_post) |
| `REDIRECT_URI` | yes | — | `https://<host>/auth/callback` |
| `OAUTH_TOKEN_URL` | * | — | Token endpoint. Required unless supplied via discovery or alias |
| `OAUTH_JWKS_URL` | * | — | JWKS endpoint. Required unless supplied via discovery or alias |
| `OAUTH_AUTHORIZE_URL` | * | — | Authorization endpoint. Required in standard mode (or via discovery) |
| `OIDC_ISSUER` | no | — | Provider issuer URL. Triggers OIDC discovery + sets default flow mode to `standard` |
| `OAUTH_SCOPES` | no | `openid` | Space-separated scopes sent in `/auth/login` redirect |
| `OAUTH_ALLOWED_ALGS` | no | `ES256,RS256` | Comma-separated JWT signing alg allowlist |

### Legacy aliases (back-compat — still accepted)

| Variable | Canonical equivalent | Notes |
|----------|---------------------|-------|
| `MYCELIUM_TOKEN_URL` | `OAUTH_TOKEN_URL` | Accepted when `OAUTH_TOKEN_URL` is absent |
| `MYCELIUM_JWKS_URL` | `OAUTH_JWKS_URL` | Accepted when `OAUTH_JWKS_URL` is absent |
| `JWT_ISSUER` | `OIDC_ISSUER` | Used as both the expected JWT `iss` and discovery issuer |

### Flow mode

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `AUTH_FLOW_MODE` | no | auto | `tap-initiated` or `standard`. Auto-detected: `standard` when `OIDC_ISSUER` or `OAUTH_AUTHORIZE_URL` is set; `tap-initiated` otherwise |

**`tap-initiated`**: Current mycelium behavior. `/auth/callback` works without a prior `/auth/login`; state and PKCE are not required or enforced. Existing k8s deployments using only `MYCELIUM_*` vars run in this mode with no changes needed.

**`standard`**: Full OIDC authorization_code flow. `/auth/login` must be hit first to generate `state` + PKCE verifier (stored in a signed short-lived cookie). `/auth/callback` requires matching `state` and sends `code_verifier` in the token exchange.

### Session

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `SESSION_HMAC_KEY` | yes | — | HMAC-SHA256 signing key (32+ random bytes) |
| `SESSION_TTL_DAYS` | no | `30` | Session lifetime in days |
| `SESSION_COOKIE_NAME` | no | `crate_session` | Name of the session cookie |
| `STATE_COOKIE_NAME` | no | `crate_state` | Name of the short-lived state+PKCE cookie (standard mode) |

### Application

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `AUTH_LOCAL_OPEN` | no | `false` | When `true`: skip provider config; `/auth/verify` always 200; ephemeral `SESSION_HMAC_KEY` if unset. **Local Docker Desktop dev only.** |
| `PORT` | no | `9090` | HTTP listen port |
| `APP_ORIGIN` | no | `''` | Post-auth redirect target; falls back to `/` |
| `KONAMI_SEQUENCE` | no | `up,up,...,b,a` | Comma-separated backdoor key sequence |
| `JWKS_CACHE_TTL_SECONDS` | no | `3600` | JWKS cache TTL fallback when no `Cache-Control max-age` is present |

---

## Endpoints

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/auth/login` | Standard mode only. Redirects to `authorization_endpoint` with `state`, `code_challenge` (S256), and scopes. Sets a short-lived signed state cookie. |
| `GET` | `/auth/callback?code=...` | Exchange code → verify JWT → set `crate_session` cookie → 302 to `APP_ORIGIN`. In standard mode, also validates `state` and sends `code_verifier`. Failures render the decoy page. |
| `GET` | `/auth/verify` | Traefik forwardAuth target. 200 if valid session cookie, else 401 + decoy HTML. |
| `POST` | `/auth/konami` | Body `{"sequence":[...]}`. On match, set session → 200. Else 401. |
| `GET` | `/auth/logout` | Clear session cookie → 302 to `APP_ORIGIN`. |
| `GET` | `/health` | 200 plain text (bypasses forwardAuth). |

---

## Minimal env examples

### mycelium tap-initiated (existing deployment — zero changes)

```env
MYCELIUM_TOKEN_URL=http://mycelium.mycelium.svc:8080/oauth/token
MYCELIUM_JWKS_URL=http://mycelium.mycelium.svc:8080/.well-known/jwks.json
OAUTH_CLIENT_ID=crate
OAUTH_CLIENT_SECRET=...
REDIRECT_URI=https://crate.example.com/auth/callback
SESSION_HMAC_KEY=...
JWT_ISSUER=https://mycelium.example.com
```

### Generic OIDC (standard mode, discovery)

```env
OIDC_ISSUER=https://accounts.provider.com
OAUTH_CLIENT_ID=crate
OAUTH_CLIENT_SECRET=...
REDIRECT_URI=https://crate.example.com/auth/callback
SESSION_HMAC_KEY=...
```

(`OAUTH_TOKEN_URL`, `OAUTH_JWKS_URL`, `OAUTH_AUTHORIZE_URL` are derived from discovery. `AUTH_FLOW_MODE` auto-sets to `standard`.)
