# ADR 0004 — Crate ↔ mycelium integration boundary

**Status:** Accepted. **Corrects** ADR 0002 (#3, #4), ADR 0003 (membrane
mapping), and the framing of PRD R-ID-1, R-ID-6, R-PORT-5.
**Date:** 2026-06-26
**Context:** `mycelium-okf` bundle (`architecture/overview.md`,
`data-model/proof-of-tap.md`, `data-model/signing-keys.md`,
`domain/key-management.md`)

## Context

mycelium is an **existing platform** (7 repos under `mycelium-network-io`): a Go
backend doing NTAG424 CMAC validation + JWT issuance, Authelia/LLDAP identity,
Postgres with an `owner_id` ownership graph, and a **single global ES256 issuer**
(deliberately not per-user). Earlier Crate ADRs wrongly assumed per-artist
mycelium signing keys and placed entitlement authority *inside* mycelium. We
reconcile, and we choose **loose coupling**: Crate depends only on mycelium's
public surface and owns its own access logic.

## Decision

### Sovereignty reading: A
The interchangeable **host is the Crate streaming node** (self-host or label).
mycelium is the **shared, stable trust fabric** that makes hosts interchangeable;
it is not "the host." Sovereignty = an artist moves freely between Crate hosts
with identity, catalog, and entitlements intact.

### Two deliberately decoupled trust domains

**1. mycelium — shared trust fabric (tag authenticity + identity only).**
- Proves a physical tag is real (NTAG424 CMAC + monotonic counter) and provides
  tag **identity**: tag → collection → collection-group.
- Crate integrates as an **OAuth2 relying party** via proof-of-tap:
  `GET /links/{uuid}` (tap) → single-use code → `POST /oauth/token` → short-lived
  ES256 JWT, verified **offline against the one JWKS** (`iss=mycelium`).
- Crate **may additionally GET tag info** (collection / collection-group) to
  resolve behavior.
- Crate does **NOT** use mycelium's `CONTENT_KEY` dispense / key pools.
- mycelium does **NOT** store or author Crate entitlements.

**2. Crate control-plane — per-artist, portable (resolution + entitlement).**
- The artist's **own signing identity** (separate from mycelium's issuer) signs
  the `crate.bundle`, vouch graph, and replication grants. This is the
  per-artist key the PRD imagined — it lives in **Crate's portable
  control-plane, not mycelium**.
- The **entitlement ledger** resolves *what a verified tag grants*: membrane
  (radio/member/owner), catalog/collection mapping, metering, offline. It
  travels with the artist across Crate hosts.

### Resolution ownership
**Crate decides what a tag resolves to.** mycelium supplies authenticity +
identity; Crate maps `mycelium collection / collection-group → membrane + catalog`
(config/convention) and applies its own entitlement + metering. The **beacon vs
keychain** objects are modeled in mycelium; **Crate interprets** which membrane
each confers — without using content keys.

### Radio
Radio is **host-only**: a public host URL, **no mycelium interaction** at all.

## Consequences

- **MYC track is integration, not custody-building.** crate-auth is an OAuth2
  client of mycelium; tap verification, key custody, JWKS already exist.
- **Per-artist signing is real but Crate-side** (bundles/vouches/grants),
  correcting the location implied by PRD R-ID-1/R-PORT-5. mycelium's single
  issuer signs only proof-of-tap.
- **Entitlement authority is Crate-side and portable** (correcting PRD R-ID-6 and
  ADR 0002 #3/#4): the ledger is not locked in mycelium, which *strengthens*
  sovereignty. Metering accounting lives with this Crate entitlement authority.
- **Loose coupling:** Crate uses only mycelium's public surface (`/links`,
  `/oauth/token`, JWKS, optional tag-info GET) — no management-plane dependency.
  A mycelium outage blocks *new* taps but not radio nor already-issued,
  edge-verified sessions.

## Addressing — no co-location assumption

A crate node must address external dependencies (mycelium today; storage and peer
nodes later) by **public, configurable URLs** — never by in-cluster service DNS
(`*.svc.cluster.local`) or any address that assumes co-location. Only a node's
**own** components (crate-auth, crate-web, Navidrome, Traefik) may use
intra-deployment addresses. This keeps a node portable across compose, appliance,
cloud, and clusters, and is required for the distribution mesh (nodes reach each
other externally). Runtime provider endpoints are `OAUTH_TOKEN_URL` /
`OAUTH_JWKS_URL` (PUBLIC); the in-cluster default was a bug.

**Consequence for mycelium:** an off-cluster relying party needs mycelium's
`/oauth/token` reachable publicly (alongside the already-public `/.well-known/jwks.json`).
Confirm/expose this on the mycelium side.

## Supersedes / corrects

- **ADR 0002 #3** — not "per-artist JWKS"; one platform issuer, authority via
  Crate's portable entitlement ledger + tag identity.
- **ADR 0002 #4** — metering "authority layer" = Crate's entitlement
  control-plane, not mycelium.
- **ADR 0003** — membranes are **not** mapped to mycelium `OAUTH2`/`CONTENT_KEY`
  mapping types; Crate resolves membranes from tag identity. Radio is host-only.

## Open knobs

- The tag-info GET contract (fields, auth) between Crate and mycelium.
- Whether collection/group → membrane mapping is Crate config or convention.
- Token TTL/refresh (mycelium OAuth tokens are 1h; Crate session cadence on top).
