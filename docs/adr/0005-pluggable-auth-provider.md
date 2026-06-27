# ADR 0005 — Pluggable auth provider (generic OAuth2/OIDC)

**Status:** Accepted (implemented). **Extends** ADR 0004.
**Date:** 2026-06-27
**Context:** `crate-auth/` ; PR #17 ; ADR 0004 (loose coupling)

## Context

crate-auth assumed mycelium specifically. To honor ADR 0004 (mycelium is a
loose-coupled trust fabric, not the necessary center), crate-auth is generalized
into a standard OAuth2/OIDC relying party. mycelium becomes **one provider
profile**, not a hard dependency.

## Decision

crate-auth is a **generic OAuth2/OIDC client + self-signed session minter**.

1. **OIDC discovery.** Set `OIDC_ISSUER`; crate-auth fetches
   `${issuer}/.well-known/openid-configuration` to derive `authorization_endpoint`,
   `token_endpoint`, `jwks_uri`, issuer. Explicit endpoint vars override discovery.

2. **Provider-agnostic config** with back-compat. New `OAUTH_*` / `OIDC_ISSUER`
   vars; `MYCELIUM_*` / `JWT_ISSUER` accepted as aliases. Precedence:
   explicit > discovery > alias.

3. **Alg-agnostic verification.** Verify by JWK type — `kty=EC` -> ES256,
   `kty=RSA` -> RS256 — gated by `OAUTH_ALLOWED_ALGS` (default `ES256,RS256`).
   **mycelium stays ES256; we do not switch it.** The relying party supports a set
   of algs; the provider picks one (standard practice). RS256 unlocks mainstream
   IdPs (Google, Auth0, Keycloak, Okta, Authelia).

4. **Two flow modes.**
   - `tap-initiated` (mycelium, default): the **tap** initiates and supplies the
     code; the callback needs no prior `state`. Exact prior behavior preserved.
   - `standard` (generic OIDC): `GET /auth/login` redirects to the authorize
     endpoint with `state` + **PKCE (S256)** in a short-lived signed cookie; the
     callback validates `state` and sends the `code_verifier`.
   `AUTH_FLOW_MODE` auto-detects from config; explicit override wins.

After the exchange, crate-auth mints its **own HMAC session cookie** — so the
provider is touched only at login; sessions are provider-independent.

## Relationship to mycelium and the membranes

- A **generic OIDC provider** yields a plain authenticated session.
- **mycelium** additionally carries **tag + collection identity** (proof-of-tap),
  which is what beacon/keychain membrane resolution (ADR 0003) needs. So mycelium
  remains the provider you choose for **tap-proof membership**; any OIDC provider
  covers ordinary login-based access. Membrane/entitlement resolution stays
  **Crate-side** either way (ADR 0004).

## Consequences

- mycelium is no longer the necessary center for auth; Crate can run against any
  OAuth2/OIDC IdP.
- No new dependencies; `session.js` / `decoy.js` / `konami.js` unchanged;
  existing MYCELIUM_* deployments boot identically (tap-initiated).

## Recommendation (optional, not blocking)

mycelium does **not** need to publish `.well-known/openid-configuration` for this
to work (crate-auth uses explicit URLs in tap-initiated mode). If desired later,
mycelium could publish a **partial** discovery doc (`issuer`, `jwks_uri`,
`token_endpoint`, `id_token_signing_alg_values_supported: ["ES256"]`,
`grant_types_supported: ["authorization_code"]`) so it is configurable by issuer
URL like any other provider. It would omit a standard `authorization_endpoint`
(the tap is the initiator). Follow-up in `mycelium-network`.
