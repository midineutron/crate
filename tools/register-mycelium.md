# Registering Crate with mycelium (OAuth2 proof-of-tap)

`tools/register-mycelium.sh` wires Crate into the already-deployed
[mycelium](https://github.com/rmzi/mycelium-network) network as an OAuth2
client. It performs three steps against the **public mycelium management API**
and changes **no** mycelium code.

## What it does

1. **Create OAuth client** — `POST /oauth/clients` with
   `{ name, redirect_uris: ["https://<HOST>/auth/callback"] }`.
   Returns `client_id` and a `client_secret` that is **shown exactly once**.
2. **Create OAUTH2 link mapping** — `POST /mappings` with
   `{ mapping_type: "OAUTH2", oauth_client_id: <client_id> }`.
   (`token_delivery` defaults to `COOKIE` server-side; OAUTH2 only requires
   `oauth_client_id`.) Returns `mapping_id`.
3. **Assign the mapping** (optional) to a tag or collection so a scan routes
   through it:
   - Tag: `PATCH /tags/<id>` `{ "link_mapping_id": "<mapping_id>" }`
   - Collection (default for every tag in it):
     `PATCH /collections/<id>` `{ "default_link_mapping_id": "<mapping_id>" }`

The resulting flow at scan time:

```
tag scan -> mycelium OAUTH2 mapping -> 302 https://<HOST>/auth/callback?code=...
         -> crate-auth exchanges code at /oauth/token -> JWT -> session cookie
```

## Auth: the management endpoints are OIDC-protected

`/oauth/clients`, `/mappings`, `/tags/:id`, and `/collections/:id` are behind
mycelium's OIDC middleware (Authelia). You must pass a valid **Bearer token**
(an Authelia OIDC access/ID token for the admin user) via `--token` /
`$MYCELIUM_TOKEN`. The token is sent as `Authorization: Bearer <token>`.

> `/oauth/token` (used later by crate-auth at runtime, not by this script) is
> **not** OIDC-protected — it authenticates with the client_id/client_secret.

## Prerequisites

- `curl` and `jq` on your PATH.
- An Authelia OIDC bearer token for the mycelium admin account.
- The public hostname Crate will serve from (controls the redirect URI and
  must match crate-auth's `REDIRECT_URI`).

## Usage

```bash
./tools/register-mycelium.sh \
  --base-url https://api.mycelium.example.com \
  --host crate.example.com \
  --token "$(cat ~/.mycelium-token)" \
  --tag-id 11111111-2222-3333-4444-555555555555      # or --collection-id <uuid>
```

All values can also be supplied as environment variables: `MYCELIUM_BASE_URL`,
`HOST`, `MYCELIUM_TOKEN`, `CLIENT_NAME`, `TAG_ID`, `COLLECTION_ID`.
Run `./tools/register-mycelium.sh --help` for the full list.

> Use the **external** mycelium URL here — registration is a one-time admin
> action from your workstation. crate-auth, by contrast, talks to mycelium over
> in-cluster Service DNS at runtime (`MYCELIUM_TOKEN_URL`, `MYCELIUM_JWKS_URL`).

## Output → crate-auth Secret

On success the script prints:

```
OAUTH_CLIENT_ID=<uuid>
OAUTH_CLIENT_SECRET=<secret>     # shown ONCE
REDIRECT_URI=https://<HOST>/auth/callback
mapping_id=<uuid>
```

Copy `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, and `REDIRECT_URI` straight into
the crate-auth Kubernetes Secret (see the k3s manifests). **Do not commit the
real secret** — manifests ship a `*.example` placeholder only.

If the secret is lost, rotate it:

```bash
curl -X POST https://api.mycelium.example.com/oauth/clients/<client_id>/rotate-secret \
  -H "Authorization: Bearer $MYCELIUM_TOKEN"
```

## Token-exchange contract (reference for crate-auth)

mycelium `POST /oauth/token` expects **form-encoded** (`client_secret_post`):

```
grant_type=authorization_code
code=<code from /auth/callback>
client_id=<OAUTH_CLIENT_ID>
client_secret=<OAUTH_CLIENT_SECRET>
redirect_uri=https://<HOST>/auth/callback
```

Response:

```json
{ "access_token": "<JWT>", "token_type": "Bearer", "expires_in": 3600 }
```

crate-auth validates that JWT against the mycelium JWKS
(`/.well-known/jwks.json`) before minting its own session cookie.
