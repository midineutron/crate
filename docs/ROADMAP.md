# Crate — Roadmap

Two-tier delivery plan derived from `docs/PRD.md`.

- **Milestone (M)** — a shippable release outcome. Maps to PRD §11 phases.
- **Epic (E)** — independently demoable, weeks-sized unit of work under a milestone.
- **Component track** — cross-cutting work with a single owner, consumed by
  milestone epics via API. Prevents a component (e.g. mycelium) from being
  smeared across unrelated milestones.

Status: **Draft v0.1** — structure agreed; deployment topology and USB ingest
still under discussion (see "Open architecture questions").

---

## Component track: MYC — mycelium (the moat)

Single-owned. Everything touching keys / identity / entitlement lives here and
is consumed by milestone epics through an API — never by leaking keys.

| Epic | Deliverable | PRD |
|---|---|---|
| MYC-1 | Service skeleton: **universal listener identity** (every participant; artist/DJ/provider are additive role grants) + key custody + JWKS publishing (ADR 0002) | R-ID-1, R-ID-3a |
| MYC-2 | Entitlement authority API (`preview\|full` + perks decision, never keys) | R-ID-3, R-ID-6 |
| MYC-3 | NTAG424 key custody + tap verification (CMAC + monotonic counter) | R-ID-2, R-ID-4 |
| MYC-4 | Token-sealing API (seal/unseal OAuth refresh tokens) | R-DL-7 |
| MYC-5 | Bundle signing + identity publishing (detached sig over content-hash list) | R-PORT-5 |
| MYC-6 | Vouch-graph signing | R-DISC-1, R-DISC-4 |

## Component track: PLAT — platform / NFR / security

| Epic | Deliverable | PRD |
|---|---|---|
| PLAT-1 | Reproducible images, CI, pinned SHAs, GHCR | §10 operability |
| PLAT-2 | Per-node isolation + multi-node cost verification | NG4, §10 cost |
| PLAT-3 | Security verification harness: keys never reach host runtime | §9 |
| PLAT-4 | Edge-verified resilience: node survives mycelium/index outage | §10, R-ID-3a |

## Component track: DIST — distribution / packaging

How the same software reaches the operator tiers (PRD G6 — topology, not tenancy).

**Decided:** `docker-compose` is the canonical artifact; **k8s manifests are a
parallel canonical form sharing the same images**; appliance and cloud are thin
wrappers over compose. **DIST-1 is pulled into early M1** (it makes all
downstream milestone work runnable locally and unblocks the onboarding tiers).

| Epic | Deliverable | Operator |
|---|---|---|
| DIST-1 | Canonical container images + `docker-compose` stack (**early M1**) | baseline for all tiers |
| DIST-2 | Appliance image ("Crate OS"): flashable Pi / old-PC distro, setup wizard | non-technical, plug-and-play |
| DIST-3 | Cloud one-click / hosted deploy | non-technical, cloud |
| DIST-4 | k3s manifests (exists today) | technical, cluster |

---

## SK-0 — Walking skeleton (thesis spike) — runs EARLY

Thinnest end-to-end path proving the core bet: a trivial node with a stub
catalog, minimal MYC-1 identity, a minimal signed bundle, one entitlement —
migrated host A→B with access intact. De-risks sovereignty before the big build.

**Pulls minimal slices of:** MYC-1, MYC-2, MYC-5, M3.
**Exit (binary):** stubbed node migrates A→B, 1 entitlement survives, no prior-host cooperation.

---

## M0 — Foundations  (done)

E0.1 k3s + Traefik + forwardAuth · E0.2 crate-auth OAuth stub + JWKS + session ·
E0.3 PWA + NFS catalog.

## M1 — Catalog + data layer

| Epic | Deliverable | PRD | Dep |
|---|---|---|---|
| E1.1 | Navidrome per node, Subsonic→PWA, edge-gated | R-CAT-1..3 | M0 |
| E1.2 | Storage source abstraction + single selectable source (local / USB / cloud); Google Drive OAuth + lazy VFS as first cloud origin (ADR 0001) | R-DL-2..4 | E1.1, MYC-4 |
| E1.3 | Cache mgmt: LRU + size cap, manifest/artwork pinned, rebuildable | R-DL-1,4,6 | E1.2 |
| E1.4 | Ingest watcher + auto-manifest write-back; in-interface upload → write-target source | R-CAT-4 | E1.2 |
| E1.5 | "Crate is a folder" onboarding (connect→drop→play) | R-DL-3, G2 | E1.1-1.4 |
| E1.6 | Manifest schema: content-addressed track IDs (ADR 0002) + per-track **radio-eligibility** flag (ADR 0003) | R-CAT-4 | E1.4 |

## M2 — Proof-of-tap + tiers

| Epic | Deliverable | PRD | Dep |
|---|---|---|---|
| E2.1 | NTAG424 SDM verification wired (crate-auth → MYC-3); resolves **beacon→presence** vs **keychain→ownership** credential (ADR 0003) | R-ID-3 | M1, MYC-3 |
| E2.2 | Graduated **radio / member / owner** sessions (ADR 0003, supersedes §8.2 preview/full), edge token verify vs JWKS | R-ID-5, R-ID-3a | E2.1, MYC-2, PLAT-4 |
| E2.3 | Rolling-window metering on **member on-demand only** (radio unmetered, owner unmetered; ADR 0003); **quota boundary at token/authority layer** for future distributed serving + earned credit (ADR 0002) | R-AC-1,3,4 | E2.2, MYC-2 |
| E2.4 | Offline download gated to **owner** tier | R-AC-2, R-UI-4 | E2.2 |
| E2.5 | Per-node radio serving mode: non-interactive broadcast of artist-flagged tracks (public membrane + discovery surface) (ADR 0003) | R-DISC-3 | E1.6, E2.2 |

## M3 — Sovereignty spine

| Epic | Deliverable | PRD | Dep |
|---|---|---|---|
| E3.1 | `crate.bundle` format + signing (content-hash IDs per E1.6; signing track extensible to replication grants) | R-PORT-1, MYC-5 | M2, E1.6 |
| E3.2 | Migration execution: import, re-point identity + storage | R-PORT-2,3,4 | E3.1 |
| E3.3 | Sovereignty proof harness (full A→B, real catalog + tags) | §12 binary | E3.2, PLAT-3 |
| E3.4 | Multi-source composition: rclone union, per-source priority, write-target, opinionated-default sync w/ override (ADR 0001) | R-DL-2, R-PORT-2 | E1.2, E3.2 |

## M4 — Discovery + provisioning

| Epic | Deliverable | PRD | Dep |
|---|---|---|---|
| E4.1 | Signed `/.well-known/crate-network.json` vouch graph | R-DISC-1,3 | MYC-6 |
| E4.2 | Label crawler / discovery index | R-DISC-2 | E4.1 |
| E4.3 | Tag provisioning + entitlement recording (in-person, §14): **beacons** (communal presence) + **keychains** (individual ownership) (ADR 0003) | R-COM-1,3 | M2, MYC-2 |
| E4.4 | Bearer ownership (keychain) + optional claim; beacon presence sessions | R-COM-2 | E4.3 |

## M5 — Payments + polish + federation (deferred, §14)

| Epic | Deliverable | PRD | Dep |
|---|---|---|---|
| E5.1 | First-party commerce primitive (payment processor) | R-COM-4 | E4.3 |
| E5.2 | Label storefront over same entitlement API | R-COM-4 | E5.1 |
| E5.3 | PWA tier/quota/discovery UX, perks | R-UI-2,3 | M2, M4 |
| E5.4 | Optional ActivityPub bridge | NG3 | E4.2 |

---

## Dependency DAG

```
MYC-1 ─┬─► SK-0 (early thesis spike)
       ├─► MYC-2 ─► E2.2, E4.3
       ├─► MYC-3 ─► E2.1
       ├─► MYC-4 ─► E1.2
       ├─► MYC-5 ─► E3.1
       └─► MYC-6 ─► E4.1

M0 ─► E1.1 ─► E1.2 ─► {E1.3, E1.4} ─► E1.5            (M1 done)
M1 ─► E2.1 ─► E2.2 ─► {E2.3, E2.4}                    (M2 done)
                 └─► E4.3 ─► E5.1 ─► E5.2   ← §14 early in-person commerce slice
M2 ─► E3.1 ─► E3.2 ─► E3.3   (SOVEREIGNTY PROOF — binary, must pass)
MYC-6 ─► E4.1 ─► E4.2
{M2, M4} ─► E5.3

E1.2 (single selectable source) ─► E3.4 (multi-source union + sync)   ← ADR 0001

PLAT-1 underpins all (CI/images). PLAT-2/3/4 gate M2/M3 exits.
DIST-1 (compose) lands early in M1 and underpins M1+; DIST-2/3 gate the §12 onboarding metric.
```

---

## Open architecture questions

### Q-DIST — Deployment topology / packaging  (RESOLVED)
`docker-compose` is the canonical artifact; k8s manifests are a parallel
canonical form sharing the same container images; appliance (Crate OS, Pi /
old-PC) and cloud one-click are thin wrappers over compose. DIST-1 (compose)
lands in early M1. See track DIST.

### Q-MEMBRANE — Access membranes  (ADR 0003, RESOLVED — refines §8.2 + Q1)
Outside the network = **radio** (non-interactive broadcast, unmetered, no tag).
Inside = **member** (tap a shared **beacon** → on-demand, metered). Core =
**owner** (buy an individual **keychain** → offline, unlimited, perks, bearer).
Radio is per-node and artist-curated (per-track radio flag); network dial
deferred. Folded into E1.6, E2.1, E2.2, E2.3, E2.4, E2.5, E4.3, E4.4. See
`docs/adr/0003-access-membranes.md`. Open knobs: beacon session lifetime; radio
as live stream vs shuffled flagged set.

### Q-DIST-MESH — Distribution & participant roles  (ADR 0002)
Long-horizon: DJ/curator role, reference-based mixes, and a node-serving mesh
(streams from closest/strongest node, not only origin). **Binding now** (folded
into MYC-1, E1.6, E2.3, E3.1): universal listener identity, content-addressed
tracks, origin-resolves authority invariant, metering boundary at the
token/authority layer, pull-based signed replication grants. **Deferred / open:**
reference mixes, hybrid index+P2P serving mesh, provider-credit economy. See
`docs/adr/0002-distribution-and-participant-roles.md`.

### Q-STORAGE — Storage source composition model  (OPEN — under discussion)
Supersedes the earlier narrow "USB" question. A node should support **multiple
storage sources used together**, not a single origin remote:

- **Source types:** local disk · removable USB · cloud remote (Drive/Dropbox/S3/NAS).
- **Selectable mount:** any source can back the application.
- **Composition:** multiple sources merge into one logical catalog. Candidate
  primitive: rclone `union` / `combine` (presents several backends as one tree,
  with read/write + create policies).
- **Sync / mirroring:** adding a second source can mirror the first — e.g. connect
  cloud sync alongside a USB origin and the cloud picks up references to the USB
  content (backup + remote reachability), or cloud is origin and USB is an
  offline replica.
- **Per-source role:** origin (authoritative) · mirror/replica · cache.

Why it matters for migration (M3): this generalizes the portability fork.
A node migrates by **re-pointing its source set**. If at least one source is a
reachable cloud remote, the new host rebuilds by reference (no physical media).
If the only source is local/USB, migration is by copy (move bytes). Mixed
source sets get the best of both — local-first for plug-and-play, cloud mirror
for portability and backup.

**Resolved → ADR 0001** (`docs/adr/0001-storage-source-composition.md`):
composable sources with per-source roles; authority by artist-configured
priority; one designated write/upload target; opinionated-default sync with user
override; single selectable source in M1, multi-source union + sync in M3 (E3.4).
Remaining knobs (default sync specifics, union create-policy, USB hot-plug UX)
tracked in the ADR, non-blocking.
