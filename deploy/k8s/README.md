# Crate on k3s — manifests

Deploys Crate behind mycelium OAuth on k3s: `crate-web` (nginx SPA + NFS
catalog) and `crate-auth` (mycelium OAuth front door + session minter), gated by
Traefik forwardAuth, with TLS from cert-manager.

## Prerequisites

- k3s with its default **Traefik** ingress and the `web`/`websecure` entrypoints
- **cert-manager** installed
- **mycelium** already running in-cluster (reachable via service DNS)
- A **Synology NAS** NFS export holding the catalog
- Public **DNS** A/AAAA record for your host pointing at the cluster
- Images published: `ghcr.io/midineutron/crate` and `ghcr.io/midineutron/crate-auth`

## Placeholders to replace

Search-and-replace these across the manifests before applying:

| Placeholder | Meaning | Example |
|-------------|---------|---------|
| `__HOSTNAME__` | Public host fronting Crate | `crate.example.com` |
| `__NAS_IP__` | Synology NAS IP | `192.168.1.10` |
| `__NAS_EXPORT_PATH__` | NFS export path | `/volume1/crate` |
| `__MYCELIUM_NS__` | Namespace mycelium runs in | `mycelium` |
| `__JWT_ISSUER__` | Expected `iss` from mycelium (blank = skip check) | `https://mycelium.example` |
| `__ACME_EMAIL__` | Let's Encrypt contact email | `you@example.com` |

```sh
# Example bulk substitution (review the diff afterward):
cd deploy/k8s
grep -rl '__HOSTNAME__' . | xargs sed -i '' 's/__HOSTNAME__/crate.example.com/g'
# ...repeat per placeholder (use `sed -i` without '' on GNU/Linux)
```

## Catalog (NFS) layout

The NAS export (`__NAS_EXPORT_PATH__`) must contain:

```
manifest.json
audio/*.mp3
artwork/*
```

It is mounted **read-only** into crate-web at `/catalog`. nginx serves
`/manifest.json`, `/audio/`, `/artwork/` from there (range requests enabled for
audio seeking). The catalog is never baked into the image.

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
kubectl -n crate get pods,svc,ingressroute,certificate
kubectl -n crate describe certificate crate-tls   # TLS issuance status
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
