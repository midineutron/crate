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
`crates.mycelium-network.io` (or at least `/rest/*`, `/audio/*`, `/artwork/*`,
`/manifest.json`). Otherwise Cloudflare caches `.mp3`/artwork by extension,
ignoring cookies, which would serve media past the forwardAuth gate.

## Prerequisites

- k3s with its default **Traefik** ingress (`web` entrypoint, :80)
- An in-cluster **cloudflared** tunnel for `crates.mycelium-network.io`
- **mycelium** reachable at its **public** URL (an external service; this node
  does not need mycelium in the same cluster). Set `OAUTH_TOKEN_URL` /
  `OAUTH_JWKS_URL` to that public host.
- A **Synology NAS** NFS export holding the catalog
- Images published (public): `ghcr.io/midineutron/crate` and `ghcr.io/midineutron/crate-auth`

## Placeholders to replace

The host is filled in (`crates.mycelium-network.io`). Set the provider URLs
(`OAUTH_TOKEN_URL` / `OAUTH_JWKS_URL`) to mycelium's **public** host — not an
in-cluster address — then fill the NAS values:

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

## Navidrome (catalog + streaming backend)

`40-navidrome.yaml` runs **Navidrome** (Subsonic-API server) as the per-node
catalog runtime and audio stream backend. It is **ClusterIP-only** — never
exposed via Traefik/Ingress. `crate-web` reverse-proxies `/rest/*` to it so all
catalog reads and audio streams stay **same-origin** with the room SPA (required
by the Web Audio analyser and the iOS lock-screen path). See GitHub #11.

- **Music**: the existing catalog NFS PVC (`crate-catalog-pvc`) is mounted
  **read-only** at `/music`. `ND_MUSICFOLDER=/music`.
- **DB/cache**: a **separate writable PVC** (`navidrome-data`, RWO,
  `local-path`) at `/data`. The music NFS stays read-only. The DB is
  disposable — delete the PVC and rescan to regenerate the catalog.
- **Auth at the gate**: nginx injects `Remote-User: crate` (overriding any
  client value); Navidrome trusts that header only from
  `ND_REVERSEPROXYWHITELIST`. No Subsonic credential reaches the browser.

**Adjust for your cluster before applying:**

- `ND_REVERSEPROXYWHITELIST` defaults to the k3s pod CIDR `10.42.0.0/16`. Set it
  to your cluster's pod network so only in-cluster proxies can assert
  `Remote-User`.
- `storageClassName: local-path` on `navidrome-data` — change if your default
  RWO StorageClass differs.
- `nodeSelector: kubernetes.io/hostname: lenovo1` pins Navidrome to one node so
  its node-local DB volume follows the pod. Change to your target node's
  hostname (a reschedule elsewhere forces a full library rescan).

**Verify on the cluster** (not verifiable off-cluster):

```sh
kubectl -n crate rollout status deploy/navidrome
# Same-origin proxy reaches Navidrome (through the gate, with a valid session):
#   curl -s https://crates.mycelium-network.io/rest/ping.view?f=json  -> "ok"
# Navidrome is NOT publicly reachable except via /rest/* through crate-web.
# Deleting the navidrome-data PVC + rescanning regenerates the catalog.
```

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
