# crate-auth

The mycelium OAuth front door for Crate. It exchanges a mycelium
proof-of-tap authorization code for a JWT, validates that JWT against mycelium's
JWKS, and mints a 30-day self-signed HMAC session cookie. Traefik's forwardAuth
middleware calls `/auth/verify` on every request; unauthenticated requests get a
decoy `502 Bad Gateway` page (with a hidden konami-code backdoor).

Zero runtime dependencies — only Node 20 built-ins (`http`, `crypto`).

## Endpoints (`:9090`)

| Method | Path             | Behavior |
|--------|------------------|----------|
| GET    | `/auth/callback` | Exchange `?code` at mycelium `/oauth/token`, validate JWT vs JWKS, set `crate_session`, 302 to `APP_ORIGIN`. Failures render the decoy 502. |
| GET    | `/auth/verify`   | forwardAuth target. 200 if a valid HMAC session cookie is present, else 502 + decoy HTML body. |
| POST   | `/auth/konami`   | Body `{"sequence": [...]}`. On match against `KONAMI_SEQUENCE`, set session, 200; else 401. |
| GET    | `/auth/logout`   | Clear cookie, 302 to `APP_ORIGIN`. |
| GET    | `/health`        | 200 (bypasses forwardAuth). |

## Session cookie

`crate_session` = `base64url(JSON {sub,iat,exp})` + `.` + `base64url(HMAC-SHA256)`.
Verification recomputes the HMAC (constant-time) and checks `exp`. Single key:
`SESSION_HMAC_KEY`. Cookie attrs: `HttpOnly; Secure; SameSite=Lax; Path=/;
Max-Age=<SESSION_TTL_DAYS days>`.

## mycelium token exchange (confirmed against mycelium `oauth/handlers.go`)

`POST <MYCELIUM_TOKEN_URL>` form-encoded (`application/x-www-form-urlencoded`):
`grant_type=authorization_code`, `code`, `client_id`, `client_secret`,
`redirect_uri`. Client auth is **client_secret_post** (credentials in the body,
not HTTP Basic). Success returns `{access_token, token_type, expires_in}` where
`access_token` is an **ES256** JWT with `aud=client_id`, `iss=<issuer>`, and a
`kid` header matching a key in mycelium's JWKS (EC P-256). Signatures are raw
IEEE-P1363 (R‖S), verified with Node's `dsaEncoding: 'ieee-p1363'`.

## Environment variables

| Var | Required | Default | Notes |
|-----|----------|---------|-------|
| `PORT` | no | `9090` | |
| `MYCELIUM_TOKEN_URL` | yes | — | in-cluster, e.g. `http://mycelium.<ns>.svc:8080/oauth/token` |
| `MYCELIUM_JWKS_URL` | yes | — | e.g. `http://mycelium.<ns>.svc:8080/.well-known/jwks.json` |
| `OAUTH_CLIENT_ID` | yes | — | also the expected JWT `aud` |
| `OAUTH_CLIENT_SECRET` | yes | — | |
| `REDIRECT_URI` | yes | — | `https://<host>/auth/callback` |
| `SESSION_HMAC_KEY` | yes | — | random 32+ bytes |
| `SESSION_TTL_DAYS` | no | `30` | |
| `SESSION_COOKIE_NAME` | no | `crate_session` | |
| `KONAMI_SEQUENCE` | no | `up,up,down,down,left,right,left,right,b,a` | |
| `APP_ORIGIN` | no | `''` | redirect target after auth; falls back to `/` |
| `JWT_ISSUER` | no | — | expected `iss`; unchecked if unset |
| `JWKS_CACHE_TTL_SECONDS` | no | `3600` | fallback when JWKS response has no `max-age` |

## Run

```sh
node src/server.js     # or: npm start
npm test               # node --test (session, konami, JWKS/JWT)
docker build -t ghcr.io/midineutron/crate-auth .
```
