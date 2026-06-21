# Crate on k3s — manifests

Deploys Crate behind mycelium OAuth on k3s: `crate-web` (nginx SPA + NFS
catalog) and `crate-auth` (mycelium OAuth front door + session minter), gated by
Traefik forwardAuth. **TLS is terminated at the Cloudflare edge via a Cloudflare
Tunnel** — there is no cert-manager in this deployment.

## Topology (Cloudflare Tunnel)

```
browser --HTTPS--> Cloudflare edge --tunnel--> cloudflared --HTTP--> Traefik (web) --> crate-web / crate-auth
        (CF-managed cert for crates.mycelium-network.io)        (in-cluster, plain http)
```

Add this rule to your existing in-cluster cloudflared tunnel config:

```yaml
- hostname: crates.mycelium-network.io
  service: http://traefik.kube-system.svc.cluster.local:80
```

Then, in the Cloudflare dashboard, add a **Cache Rule: Bypass cache** for
`crates.mycelium-network.io` (or at least `/audio/*`, `/artwork/*`,
`/manifest.json`). Otherwise Cloudflare caches `.mp3`/artwork by extension,
ignoring cookies, which would serve media past the forwardAuth gate.

## Prerequisites

- k3s with its default **Traefik** ingress (`web` entrypoint, :80)
- An in-cluster **cloudflared** tunnel for `crates.mycelium-network.io`
- **mycelium** already running in-cluster (service `backend.mycelium`, :8080)
- A **Synology NAS** NFS export holding the catalog
- Images published (public): `ghcr.io/midineutron/crate` and `ghcr.io/midineutron/crate-auth`

## Placeholders to replace

Host and mycelium URLs are already filled in (`crates.mycelium-network.io`,
`backend.mycelium.svc.cluster.local:8080`). Only the NAS values remain:

| Placeholder | Meaning | Example |
|-------------|---------|---------|
| `__NAS_IP__` | Synology NAS IP | `192.168.1.10` |
| `__NAS_EXPORT_PATH__` | NFS export path | `/volume1/crate` |

```sh
cd deploy/k8s
sed -i 's#__NAS_IP__#192.168.1.10#; s#__NAS_EXPORT_PATH__#/volume1/crate#' 20-catalog-nfs.yaml
# (macOS: sed -i '' ...)
```

To tighten issuer checking later, set `JWT_ISSUER` in `10-config.yaml` to the
`iss` mycelium mints (its `JWT_ISSUER` env; default `mycelium`). Blank = skip
the iss check (audience is still checked against `OAUTH_CLIENT_ID`).

## Catalog (NFS) layout

The NAS export must contain:

```
manifest.json
audio/*.mp3
artwork/*
```

Mounted **read-only** into crate-web at `/catalog`. nginx serves
`/manifest.json`, `/audio/`, `/artwork/` from there (range requests enabled for
audio seeking). The catalog is never baked into the image. Ensure the NFS export
grants read access to all three k3s node IPs (lenovo1, lenovo2, dell1).

## Create the secret

`11-secret.example.yaml` is a template and is **not** applied by kustomize.
Create the real secret first (never commit real values):

```sh
kubectl create namespace crate    # or let `apply -k` create it, then re-run

kubectl -n crate create secret generic crate-auth-secrets \
  --from-literal=OAUTH_CLIENT_ID='<from mycelium POST /oauth/clients>' \
  --from-literal=OAUTH_CLIENT_SECRET='<from mycelium>' \
  --from-literal=SESSION_HMAC_KEY="$(openssl rand -base64 32)"
```

`OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` come from registering Crate as a
mycelium OAuth client (see `tools/register-mycelium.sh`).

## Apply

```sh
kubectl apply -k deploy/k8s
```

(`kustomization.yaml` applies everything except the secret.) Watch rollout:

```sh
kubectl -n crate get pods,svc,ingressroute
```

## How routing works

- `/auth/*` and `/health` → **crate-auth** (`:9090`), bypassing the gate.
- Everything else → **crate-web** (`:8080`), behind a forwardAuth Middleware
  that calls `http://crate-auth:9090/auth/verify`.
- A valid `crate_session` cookie → 200 → request proceeds.
- No/invalid session → crate-auth returns **502 + decoy page**, which Traefik
  relays verbatim to the client.
- mycelium OAuth tap → `/auth/callback?code=` → token exchange → JWT validated
  vs JWKS → `crate_session` minted → redirect to `/`.

## Notes

- `imagePullPolicy: IfNotPresent` (images are public; no pull secret needed).
- Traefik CRD API group is `traefik.io/v1alpha1`; pre-rename clusters use
  `traefik.containo.us/v1alpha1` — adjust `50-traefik.yaml` if needed.
- The PV/PVC use `storageClassName: ""` for static (non-dynamic) NFS binding.
