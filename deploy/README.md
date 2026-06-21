# Deploying Crate on k3s behind mycelium OAuth

This is the **self-hosted k3s** deployment path: Crate runs on your own cluster
with [mycelium](https://github.com/rmzi/mycelium-network) as the **sole front
door** via OAuth2 "proof-of-tap". A tag scan flows through mycelium, mints a
session, and unlocks the app. The catalog is served from a Synology NAS over
NFS — never baked into an image.

> The original **AWS / CloudFront / Terraform** path still works and is
> unchanged — see the repo-root [`README.md`](../README.md) and `terraform/`.
> The two paths are independent; pick one. This document covers k3s + mycelium.

## Architecture

```
              tag scan
                 │
                 ▼
          ┌──────────────┐   302 /auth/callback?code=…
          │   mycelium   │ ─────────────────────────────┐
          └──────────────┘                              ▼
                                              ┌─────────────────────┐
   every request ─► Traefik ──forwardAuth──►  │ crate-auth (:9090)  │
                       │      /auth/verify     │  • code→token       │
                       │                       │  • JWT vs JWKS      │
        200 ◄──────────┤  valid session        │  • mints session    │
                       │                       │  • decoy 502 + konami│
        502 decoy ◄────┘  no session           └─────────────────────┘
                       │
                       └─ valid ─► ┌─────────────────────┐
                                   │ crate-web (:8080)    │
                                   │  nginx + /catalog    │ ◄── NFS (Synology)
                                   └─────────────────────┘
```

- **crate-auth** (`:9090`) — exchanges the mycelium auth `code` for a JWT,
  validates it against mycelium's JWKS, and mints a 30-day HMAC `crate_session`
  cookie. `/auth/verify` is Traefik's forwardAuth target.
- **crate-web** (`:8080`) — nginx serving the built PWA plus the read-only NFS
  catalog at `/manifest.json`, `/audio/`, `/artwork/` (range requests enabled).
- **Traefik** — `/auth/*` and `/health` go to crate-auth; everything else goes
  to crate-web behind the forwardAuth gate. On no/invalid session, crate-auth
  returns a **decoy 502** page that Traefik relays verbatim.
- **cert-manager** — issues TLS for the host via Let's Encrypt.

## Prerequisites

- A **k3s** cluster with its default **Traefik** ingress (entrypoints `web`/`websecure`)
- **cert-manager** installed in the cluster
- **mycelium** already deployed in-cluster (reachable via service DNS)
- A **Synology NAS** with an NFS export for the catalog
- Public **DNS** record for your host pointing at the cluster
- `kubectl` (with `kustomize` built in), and for image builds: Docker + a
  GitHub account that can push to `ghcr.io/<owner>`

## 1. Build and publish the images

Two images: `ghcr.io/rmzi/crate` (web) and `ghcr.io/rmzi/crate-auth`.

### Via CI (recommended)

`.github/workflows/build-images.yml` builds and pushes both on every push to
`main` or `feat/k3s-mycelium-oauth` (and via manual `workflow_dispatch`):

- Build contexts: `crate` → repo root with `crate-web/Dockerfile`;
  `crate-auth` → `crate-auth/` with `crate-auth/Dockerfile`.
- Tags: `sha-<short>` (always), `<branch>` (always), `latest` (default branch only).

**One-time:** GHCR packages start **private**. After the first successful run,
flip each package to public (the manifests pull with no imagePullSecret):

```sh
gh api -X PATCH /user/packages/container/crate      -f visibility=public
gh api -X PATCH /user/packages/container/crate-auth -f visibility=public
```

### Locally (optional)

```sh
# web (build context = repo root; runs npm run build inside)
docker build -f crate-web/Dockerfile -t ghcr.io/rmzi/crate:dev .

# auth (build context = crate-auth/)
docker build -t ghcr.io/rmzi/crate-auth:dev crate-auth

docker push ghcr.io/rmzi/crate:dev
docker push ghcr.io/rmzi/crate-auth:dev
```

The manifests reference the `:latest` tag with `imagePullPolicy: IfNotPresent`.
For reproducible rollouts, pin the `sha-<short>` tag instead.

## 2. Prepare the Synology NAS (NFS catalog)

The catalog lives on the NAS and is mounted **read-only** at `/catalog`.

**Expected layout** under the export root (e.g. `/volume1/crate`):

```
manifest.json      # the track manifest the SPA fetches from /manifest.json
audio/*.mp3        # served at /audio/*.mp3  (range requests for seeking)
artwork/*          # served at /artwork/*
```

**Enable NFS on the Synology:**

1. Control Panel → File Services → **NFS** → enable NFS (NFSv4.1 recommended).
2. Control Panel → Shared Folder → your catalog folder → Edit → **NFS
   Permissions** → add a rule for your k3s node subnet (e.g. `192.168.1.0/24`)
   with **read-only** access, squash "no mapping", and note the **mount path**
   shown (this is `__NAS_EXPORT_PATH__`, e.g. `/volume1/crate`).
3. Ensure the k3s nodes can reach the NAS on NFS ports (2049, plus rpcbind for
   v3).

## 3. Register Crate with mycelium

Register Crate as an OAuth client and create the OAUTH2 tag mapping using
`tools/register-mycelium.sh` (calls only mycelium's public management API;
no mycelium code changes). Needs `curl`, `jq`, and an Authelia OIDC bearer
token for a mycelium admin. Full notes: `tools/register-mycelium.md`.

```sh
tools/register-mycelium.sh \
  --base-url https://api.mycelium.example.com \
  --host crate.example.com \
  --token "$(cat ~/.mycelium-token)" \
  --tag-id 11111111-2222-3333-4444-555555555555   # optional: assign to a tag
```

It prints — **save these immediately** (the secret is shown once):

```
OAUTH_CLIENT_ID=…
OAUTH_CLIENT_SECRET=…
REDIRECT_URI=https://crate.example.com/auth/callback
mapping_id=…
```

The script also creates the `OAUTH2` link mapping and (with `--tag-id` /
`--collection-id`) assigns it so a tag scan redirects to
`https://<host>/auth/callback?code=…`. The token exchange it documents matches
crate-auth: `grant_type=authorization_code` + `code` + `client_id` +
`client_secret` + `redirect_uri`, form-encoded (client_secret_post).

## 4. Fill placeholders, create the secret, apply

Manifests live in [`deploy/k8s/`](k8s/) (kustomize). See
[`deploy/k8s/README.md`](k8s/README.md) for the per-file detail.

**Replace placeholders** across `deploy/k8s/`:

| Placeholder | Meaning |
|-------------|---------|
| `__HOSTNAME__` | Public host, e.g. `crate.example.com` |
| `__NAS_IP__` | Synology NAS IP |
| `__NAS_EXPORT_PATH__` | NFS export path, e.g. `/volume1/crate` |
| `__MYCELIUM_NS__` | Namespace mycelium runs in |
| `__JWT_ISSUER__` | Expected `iss` from mycelium (blank = skip check) |
| `__ACME_EMAIL__` | Let's Encrypt contact email |

**Create the secret** (the example file is *not* applied by kustomize, so
placeholder secrets never reach the cluster):

```sh
kubectl create namespace crate
kubectl -n crate create secret generic crate-auth-secrets \
  --from-literal=OAUTH_CLIENT_ID='<from step 3>' \
  --from-literal=OAUTH_CLIENT_SECRET='<from step 3>' \
  --from-literal=SESSION_HMAC_KEY="$(openssl rand -base64 32)"
```

**Apply everything else:**

```sh
kubectl apply -k deploy/k8s
kubectl -n crate get pods,svc,ingressroute,certificate
kubectl -n crate describe certificate crate-tls   # watch TLS issuance
```

cert-manager solves the Let's Encrypt **HTTP-01** challenge through Traefik's
`web` entrypoint. The HTTP→HTTPS redirect is fine — Let's Encrypt follows the
redirect when validating. Issuance needs your DNS record live and reachable.

## 5. Verify

1. `https://<host>/health` → `200 ok` (crate-auth).
2. `https://<host>/` with no session → **decoy 502 Bad Gateway** page (no app
   shell, no media leaked).
3. Scan a mapped tag → mycelium → `/auth/callback?code=…` → app loads; audio
   plays and seeks (range requests).
4. `/manifest.json`, `/audio/*.mp3`, `/artwork/*` return 200 once authed.

## Konami decoy entry (personal backdoor)

The decoy 502 page silently listens for the **konami code** (default
`up,up,down,down,left,right,left,right,b,a`, configurable via
`KONAMI_SEQUENCE`). On a correct sequence the page `POST`s `/auth/konami`;
crate-auth validates it and mints the **same** self-signed `crate_session`
cookie as the OAuth path, then the page reloads into the app. This is an
intentional, accepted-tradeoff backdoor for the operator — it bypasses
mycelium. Rotate `SESSION_HMAC_KEY` to invalidate all existing sessions
(OAuth and konami alike).

## Notes

- Gating is **network-only**. The PWA service worker still serves its offline
  cache on already-authed devices — intentional.
- Traefik CRDs use `traefik.io/v1alpha1`; pre-rename clusters use
  `traefik.containo.us/v1alpha1` (adjust `deploy/k8s/50-traefik.yaml`).
- The AWS/CloudFront path (`terraform/`, `tools/deploy*.py`,
  `tools/sign-cookies.py`) is left intact as a parallel option.
