# Crate — Product Requirements Document

> Your crate is yours. Own it, share it. It's just music.

**Status:** Draft v0.2
**Owner:** midineutron
**Last updated:** 2026-06-24

---

## 1. Summary

Crate is an artist-first, self-sovereign music streaming platform. Each artist
runs an independent **Crate node** — a branded streaming app over a catalog they
own. Nodes can be self-hosted or operated on the artist's behalf by a **label**,
but the artist holds the root of trust the entire time: their identity, their
keys, and their masters never belong to the host.

Access to a node is gated by physical **NFC tags** the artist sells.
Anyone can land on a node and sample it under a metered preview tier; owning the
artist's tag unlocks full access, including offline ownership. Nodes advertise
peer nodes through a signed, artist-curated graph, so discovery spreads by
network effect rather than by algorithm.

Crate is not a new streaming silo. It is a portable format for owning and sharing
music, plus the runtime and trust fabric to make that format live anywhere.

---

## 2. Problem statement

Streaming today is extractive and host-rooted. Artists rent access to their own
audience: the platform owns the relationship, the discovery surface, the payout
terms, and the data. Leaving means starting over. "Independent" tooling
(Funkwhale, Navidrome) solves self-hosting but not ownership-as-a-relationship —
they are servers, not an artist economy, and migration between them is lossy
because identity is tied to the host.

Crate's thesis: **if the artist holds the keys and the masters, the host becomes
interchangeable.** Sovereignty stops being a slogan and becomes an architectural
guarantee — and on top of that guarantee you can build a real, artist-controlled
economy (physical tags, tiered access, curated discovery) that no host can
capture.

---

## 3. Goals and non-goals

### Goals

- **G1 — Sovereignty by construction.** An artist can move their node between
  hosts (self → label → another label → self) with zero loss of catalog,
  identity, fan entitlements, or branding, and without the prior host's
  cooperation beyond releasing a cache.
- **G2 — Plug-and-play for non-technical artists.** Onboarding is "connect your
  cloud drive, drop in your music, name your crate." No CLI, no S3, no manifest
  editing.
- **G3 — Physical-good access economy.** NFC tags act as cryptographically
  unforgeable keys to a node. Selling a tag sells access (and optionally
  ownership/perks).
- **G4 — Graduated access funnel.** Strangers can browse and sample under a
  metered preview tier; tag owners get full access and offline ownership.
- **G5 — Network-effect discovery.** Nodes advertise peer nodes through a signed,
  artist-curated graph; labels aggregate these into a discovery index.
- **G6 — One software, three operators.** The same software serves the
  self-hosting artist, the label hosting many artists, and the federation between
  them. No multi-tenant fork.

### Non-goals (for v1)

- **NG1** — General-purpose social network / comments / DMs.
- **NG2** — Algorithmic recommendation. Discovery is artist-curated by design.
- **NG3** — Full ActivityPub fediverse interop (kept as a future bridge, not a
  foundation).
- **NG4** — Multi-tenant shared database. Each node is an isolated partition.
- **NG5** — Acting as a CDN for arbitrary third-party storage at fan scale
  (serving is always from a host-controlled cache, never the artist's raw
  consumer drive).

---

## 4. Principles

1. **Artist holds the root.** Keys and masters live with the artist. Hosts run
   derived, disposable state.
2. **Portability is a first-class operation**, not an export feature.
3. **Legibility for the non-technical.** The crate should be something an artist
   can literally see and understand (a folder they own).
4. **Borrow solved layers, own differentiated layers.** Don't rebuild catalog
   indexing or storage connectors; do own identity, presentation, and the access
   economy.
5. **Same software across self-host, label, and federation.** Topology, not
   tenancy.
6. **Open by default for discovery; gated by ownership for access.**

---

## 5. Personas

- **Independent artist (non-technical).** Wants their music online, branded, and
  theirs. Will connect Google Drive and drop in MP3s. Sells tags at shows.
- **Independent artist (technical).** Self-hosts on their own cluster, uses S3 or
  a NAS, wants full control of infra.
- **Label operator.** Hosts multiple artists' nodes, runs the discovery index and
  NFC fulfillment/commerce, provides infrastructure to artists who don't
  self-host — without owning their work.
- **Fan.** Discovers a node, samples it under the preview tier, buys a tag to
  unlock full access and offline listening, follows the artist's vouch graph to
  neighboring nodes.

---

## 6. Glossary

| Term | Meaning |
|---|---|
| **Crate / Node** | One artist's independent streaming instance. The unit of deployment. |
| **Label** | An operator hosting many nodes + the discovery index + NFC commerce. |
| **mycelium** | The artist's portable root of trust: sovereign identity, key custody, entitlement authority. Travels with the artist, not the host. |
| **Proof-of-tap** | A cryptographically verified NFC tap — authenticity and anti-replay handled by mycelium — that mints or upgrades a session. |
| **Control-plane** | The crate's portable soul: identity refs, manifest, entitlement ledger, config, vouch graph. Small, artist-held. |
| **Data-plane** | The heavy audio masters in artist-controlled storage, referenced by the manifest, cached by the host. |
| **crate.bundle** | The portable package format that moves a node between hosts. |
| **Entitlement** | A grant (full access, offline, perks) bound to a tag and/or identity, authored by mycelium. |
| **Vouch graph** | A signed `/.well-known/crate-network.json` listing peer nodes an artist endorses. |

---

## 7. Architecture overview

### 7.1 Layered model

| Layer | Implementation | Build vs borrow |
|---|---|---|
| **Identity / access / entitlement** | mycelium (sovereign identity, NFC tag key custody, tap verification, entitlement authority) | **Build / own** — the moat |
| **Presentation** | Crate PWA (branded streaming app, offline cache, media session) | **Build / own** — the moat |
| **Catalog / library** | Navidrome per node (Subsonic API, transcoding, metadata, search) | **Borrow** |
| **Data (masters)** | Artist-controlled storage via rclone (Drive, Dropbox, S3, NAS) → host serving cache | **Borrow / abstract** |
| **Discovery / federation** | Signed `/.well-known` vouch graph + label-run index | **Build (lightweight)** |
| **Runtime / hosting** | k3s + Traefik + crate-auth + crate-web (containers, GHCR, CI) | **Have today** |

### 7.2 Request flow (per node)

```
                    NFC tap (mycelium proof-of-tap: authenticity + anti-replay)
                                   │
                                   ▼
                            ┌────────────┐  verify tap once → signed entitlement token
        every request ─► Traefik ─forwardAuth─► crate-auth ──────────────► mycelium
                            │                       │  (token verified        (key custody,
              preview/full  │                       │   at edge vs JWKS)       tap verify,
              session       │                       │ ◄─────────────────────  entitlement)
                            ▼                        ▼
                    ┌───────────────┐         metering (Redis: rolling 30d quota)
                    │   crate-web   │
                    │  PWA + serve  │ ◄── Navidrome (Subsonic API)
                    └───────────────┘ ◄── rclone VFS cache ◄── artist's Drive/S3/NAS
```

### 7.3 Control-plane / data-plane split

- **Control-plane (portable, small, artist-held):** identity refs, `manifest.json`,
  entitlement ledger, branding/config, vouch graph. Moves in seconds.
- **Data-plane (heavy, artist-owned):** audio masters in the artist's own storage,
  *referenced* not owned by the host. The host keeps a disposable, derived cache.

Migration moves the control-plane and re-points the data-plane. The host holds
nothing it cannot rebuild.

### 7.4 The crate as a folder

For non-technical artists, the data-plane and the public control-plane co-locate
as a single legible folder in the artist's own cloud drive:

```
My Drive/
└── My Crate/
    ├── audio/          # drop MP3s here
    ├── artwork/
    ├── manifest.json   # auto-built by ingest watcher
    └── config          # branding, tiers, listen limits
```

Secrets (NFC tag keys, signing identity) never live here — they are
custodied in mycelium.

---

## 8. Subsystem requirements

### 8.1 Identity, access, and entitlement (mycelium)

- **R-ID-1** — mycelium custodies, per artist, the cryptographic key material for
  their NFC tags (plus the tap-signing identity). The host runtime never receives
  these. The specific tag technology is mycelium's concern, not Crate's.
- **R-ID-2** — NFC tags are provisioned by mycelium with per-tag key material so
  each tap is uniquely verifiable; provisioning specifics are mycelium's concern.
- **R-ID-3** — crate-auth verifies each tap's authenticity and anti-replay by
  delegating to mycelium; mycelium returns an entitlement decision
  (`preview | full` + perks), never the key.
- **R-ID-3a** — **[Decision Q2]** mycelium verifies a tap **once** and mints a
  short-lived **signed entitlement token**; the edge verifies it against
  mycelium's JWKS *offline* on every request. Full-tier TTL ~24h with silent
  refresh; revocation via short TTL (+ optional revocation list). The request path
  does not depend on mycelium uptime — a node stays accessible if the
  index/authority is briefly unreachable.
- **R-ID-4** — Counter state is tracked to detect replay and cloning; anomalous
  taps (e.g., same tag, distant locations, short interval) are flaggable.
- **R-ID-5** — Sessions are graduated: absence of a tag yields a **preview**
  session, not a denial. The decoy 502 path is reserved for abuse, not arrival.
- **R-ID-6** — Entitlements are authored by mycelium and travel with the artist's
  identity across hosts, so fan access survives migration.

### 8.2 Access tiers and metering

| Tier | Browse | Listens | Quality | Offline | Trigger |
|---|---|---|---|---|---|
| **Preview** | Full | Rolling 30-day quota (~25 streams) | Stream-only | No | Default for any visitor |
| **Full** | Full | Unlimited | Full | **Yes** | Owns the node's NFC tag |
| **Abuse** | — | — | — | — | Decoy 502 |

- **R-AC-1** — Listen metering is server-enforced. Audio requests pass an
  identity-aware counter (forwardAuth into crate-auth + Redis); the client is
  never trusted to count.
- **R-AC-2** — Offline download (PWA cache) is the paid unlock — disabled in
  preview, enabled in full. This also closes the metering hole where cached plays
  never reach the server.
- **R-AC-3** — Tier limits (quota size, window, quality) are configurable per node
  in `config`.
- **R-AC-4** — **[Decision Q1]** Metering unit is a **rolling 30-day window** of
  streams (default ~25). A stream counts only after ~45s of playback, so skips and
  brief samples are free. Browse is always unlimited. Rationale: a rolling window
  matches the familiar streaming mental model, creates recurring conversion
  pressure, and avoids per-track state and big-catalog penalties.

### 8.3 Data layer (storage)

- **R-DL-1** — The artist's storage is the **origin**; the host serves fans only
  from a derived cache. Fans never hit the artist's consumer drive directly.
- **R-DL-2** — Storage is abstracted via **rclone** so Drive, Dropbox, OneDrive,
  S3, MinIO, and NAS are all supported through one code path with no lock-in.
- **R-DL-3** — Non-technical onboarding: OAuth-connect a consumer drive, drop
  files into a folder; technical artists may select S3/MinIO/NAS instead.
- **R-DL-4** — **[Decision Q3]** Default sync mode is **lazy VFS cache with
  read-ahead** (scales to large catalogs, small host footprint); fans get clean
  range/seek against the local cache. Eviction is **LRU under a per-node size
  cap**, with `manifest.json` and artwork pinned resident. **Full-mirror** is an
  opt-in `config` flag for small catalogs wanting instant first-play.
- **R-DL-5** — Optional at-rest encryption (rclone crypt) so the cloud provider
  cannot read the catalog (trades legibility for privacy).
- **R-DL-6** — The host cache is disposable and rebuildable from the origin at any
  time; nothing fan-critical exists only in the cache.
- **R-DL-7** — **[Decision Q7]** Consumer-OAuth refresh tokens are stored
  encrypted at the host and **sealed via mycelium**, so a departed host cannot
  silently retain Drive/Dropbox access. On migration the artist re-authorizes the
  new host (fresh grant) and the old sealed token is invalidated; the artist can
  also revoke at the provider at any time.

### 8.4 Catalog / library (Navidrome)

- **R-CAT-1** — Each node runs its own Navidrome indexing the rclone mount; the
  Navidrome DB is disposable per host and regenerable.
- **R-CAT-2** — The PWA consumes the catalog via Navidrome's Subsonic API
  (replacing the static `manifest.json` serving path) for search, metadata, and
  transcoding.
- **R-CAT-3** — Navidrome runs cluster-internal, gated by mycelium at the edge;
  it is never the front door.
- **R-CAT-4** — An ingest watcher runs metadata extraction on newly synced files
  and writes/updates `manifest.json` back into the artist's folder.

### 8.5 Portability and migration

- **R-PORT-1** — A node is packaged as a **crate.bundle**:
  ```
  crate.bundle
  ├── identity/      # artist signing pubkey ref; private keys custodied in mycelium
  ├── manifest.json  # tracks → artist-controlled storage URIs
  ├── entitlements/  # tag registry + ownership ledger
  ├── network.json   # signed vouch graph
  └── config/        # branding, tiers, listen limits
  ```
- **R-PORT-2** — Migration: import the bundle on a new host, the artist re-points
  their mycelium identity and storage remote; fans and tags continue working
  untouched.
- **R-PORT-3** — Migration requires no cooperation from the prior host beyond
  releasing its cache. Sovereignty must not depend on host goodwill.
- **R-PORT-4** — Each node is an isolated partition; a label hosting N artists
  runs N isolated stacks, not one shared multi-tenant database.
- **R-PORT-5** — **[Decision Q6]** The bundle carries a **detached signature over a
  content hash list**, signed by the artist's mycelium key. On import the new host
  verifies authenticity + integrity against the artist's mycelium-published
  identity; the artist then grants the new host a **scoped runtime credential**
  (never the master key). Trust-on-import = signature verification + explicit
  artist authorization.

### 8.6 Discovery and federation

- **R-DISC-1** — Each node publishes a signed `GET /.well-known/crate-network.json`
  listing endorsed peer nodes (the vouch graph). Signatures are verifiable via
  mycelium.
- **R-DISC-2** — Labels crawl vouch graphs into a discovery index.
- **R-DISC-3** — Discovery is artist-curated, not algorithmic. A fan on node A
  sees A's endorsements of B and C and can sample them under the preview tier.
- **R-DISC-4** — Federation identity is rooted in mycelium (key-rooted), making
  cross-host follows/entitlements migration-safe. ActivityPub is an optional
  future external bridge, not the foundation.

### 8.7 Commerce (NFC fulfillment and entitlements)

- **R-COM-1** — Tags are sold by the artist (direct or via a label's storefront).
  A sale provisions a tag and records an entitlement in mycelium.
- **R-COM-2** — **[Decision Q4]** Access is **always bearer** — the tag is the
  entitlement, transferable like a record; first tap just works with no account.
  **Claiming** is an explicit, optional, perks-only action that binds tag→identity
  for cross-device offline, presence history, and fan perks. The artist sets
  whether a claim is one-way or re-transferable.
- **R-COM-3** — Tap mechanics beyond access (presence-at-show, counter milestones,
  tap-gated drops) are supported by mycelium's per-tap event model.
- **R-COM-4** — **[Decision Q5]** A **first-party commerce primitive** lets a solo
  artist sell tags without a label, using the artist's own payment processor; it
  provisions the tag and records the entitlement in mycelium. **Label storefronts**
  are an optional value-add over the **same entitlement-provisioning API**. A
  self-hosting artist is never forced into a label to monetize.

### 8.8 Presentation (PWA)

- **R-UI-1** — Retain the existing branded PWA (queue, search, favorites, media
  session, deep links, offline cache, responsive).
- **R-UI-2** — Surface tier state (preview vs full), listen quota remaining, and
  the upgrade-via-tag path.
- **R-UI-3** — Surface the vouch graph as in-app discovery of neighboring nodes.
- **R-UI-4** — Offline download UI gated by full-tier entitlement.

---

## 9. Security model

- **Key custody is the load-bearing wall.** The NFC tag keys and tap-signing
  identity live only in mycelium. If they leak to the host, sovereignty
  collapses. Verification returns decisions and signed tokens, never keys.
- **mycelium proof-of-tap** provides unforgeable NFC taps (cryptographic
  authenticity) and anti-replay (tap counter). Cloning is cryptographically hard,
  not merely inconvenient. The underlying tag technology is mycelium's concern.
- **Graduated trust:** preview sessions are low-privilege; full sessions require a
  verified tap-derived entitlement token.
- **Storage isolation:** the host never holds the only copy of masters; the cache
  is derived and revocable. OAuth tokens are sealed via mycelium; optional rclone
  crypt hides the catalog from the cloud provider.
- **Threat to defend explicitly:** a malicious or coerced host attempting to
  retain the artist's audience after departure. Mitigated by key-rooted identity
  + portable entitlements (host cannot mint or verify taps, nor retain storage
  access, without mycelium).

---

## 10. Non-functional requirements

- **Performance:** fan playback served from host cache with range/seek; first-play
  latency under a small budget on lazy VFS.
- **Reliability:** node operates independently; loss of the discovery index or a
  brief mycelium outage does not break node access (tokens are edge-verified).
- **Cost:** per-node footprint small enough that a label can host many nodes
  economically and a solo artist can self-host cheaply.
- **Operability:** container images (GHCR), CI builds, k3s manifests; reproducible
  via pinned image SHAs.
- **Privacy:** minimal fan data; entitlements keyed to tags/identity, not
  surveillance.

---

## 11. Phased roadmap

**Phase 0 — Foundations (in progress).** k3s + Traefik + crate-auth + crate-web,
OAuth proof-of-tap stub, NFS catalog. *(Exists on `feat/k3s-mycelium-oauth`.)*

**Phase 1 — Catalog + data layer.**
- Slot Navidrome in as the per-node, disposable catalog runtime.
- rclone-backed storage with Google Drive as the first non-technical origin
  (lazy VFS, LRU eviction, sealed OAuth tokens).
- "Crate is a folder" onboarding: connect, drop, auto-manifest.

**Phase 2 — Real proof-of-tap + tiers.**
- NFC proof-of-tap verification wired into crate-auth via mycelium,
  minting signed entitlement tokens verified at the edge.
- Graduated sessions (preview/full) + server-side rolling-window metering (Redis).
- Offline download gated to full tier.

**Phase 3 — Sovereignty spine.**
- mycelium key custody + entitlement authority that travels with the artist.
- `crate.bundle` format (signed) + migration: ship a node between two hosts with
  tags and access intact, no prior-host cooperation.

**Phase 4 — Discovery + commerce.**
- Signed `/.well-known/crate-network.json` vouch graph + label-run crawler/index.
- First-party commerce primitive + label storefront over one entitlement API;
  bearer model with optional claim.

**Phase 5 — Polish + (optional) external federation bridge.**
- PWA tier/discovery UX, perks/tap mechanics.
- Optional ActivityPub bridge to the outside fediverse.

---

## 12. Success metrics

- **Sovereignty proof:** a node migrates between two independent hosts with 0 lost
  entitlements and no prior-host cooperation. (Binary; must pass.)
- **Onboarding:** non-technical artist goes from zero to a live, branded,
  streamable crate in under 15 minutes without touching a terminal.
- **Funnel:** preview → tag-purchase conversion rate per node.
- **Network effect:** share of new fans arriving via a peer node's vouch graph.
- **Operability:** a label can stand up a new artist node in minutes; per-node
  cost stays within target.

---

## 13. Design decisions (resolved)

| # | Question | Decision | Key remaining knob |
|---|---|---|---|
| **Q1** | Metering unit | Rolling 30-day window, ~25 streams; counts after ~45s; browse unlimited | Exact quota size and count threshold, tuned per conversion data |
| **Q2** | Tap verification interface | mycelium verifies once → signed entitlement token; edge verifies vs JWKS offline; full-tier TTL ~24h w/ silent refresh | Revocation-list vs TTL-only; refresh cadence |
| **Q3** | Sync mode + eviction | Lazy VFS + read-ahead default; LRU under size cap; manifest/artwork pinned; full-mirror opt-in | Per-node cache cap sizing |
| **Q4** | Claim model | Bearer always for access (no account on first tap); claim is explicit, optional, perks-only | One-way vs re-transferable claim, per artist policy |
| **Q5** | Storefront ownership | First-party commerce primitive (artist's own processor) + label storefront over one entitlement API | Which payment processor(s) for the first-party path |
| **Q6** | Bundle signing / trust-on-import | Detached signature over content hash list, signed by mycelium key; import verifies + artist grants scoped runtime credential | Signature scheme + hash-tree vs flat hash list |
| **Q7** | rclone consumer-OAuth | Refresh tokens encrypted + sealed via mycelium; migration re-grants and invalidates old; provider-side revocation always available | Token refresh/rotation handling at the host |

### Residual open items

- **Payment processor selection** for the first-party commerce path (Stripe
  Connect vs alternatives) — affects fees, payout sovereignty, and global reach.
- **Cache cap defaults** per node tier and eviction tuning under real catalogs.
- **Revocation strategy** — whether short TTL alone is sufficient or a revocation
  list is required for stolen/charged-back tags.
- **Claim transferability policy** — default stance and artist-facing controls.
- **Bundle hash structure** — flat list vs Merkle tree (matters for large
  catalogs and partial verification).

---

## 14. Monetization sequencing

Monetization is intentionally deferred. At launch, tag sales happen **off-platform
and in person** — at shows, direct, hand to hand. This is a feature, not a gap: it
keeps the early loop human, lets the artist set price and terms directly, and
defers all payment-processor and storefront complexity (residual #1).

Implications for sequencing:

- **In-person first.** A tag sold in person is provisioned and its entitlement
  recorded in mycelium (R-COM-1); no online checkout is required for v1.
- **Commerce primitive is later.** The first-party online commerce path (R-COM-4)
  and label storefronts move **after** Phase 3 — they layer onto the same
  entitlement-provisioning API once the access economy is proven in person.
- **What must exist early** is only tag *provisioning + entitlement recording*,
  not payment collection. The crypto and entitlement spine (Phases 2–3) is the
  real dependency; collecting money online is a downstream convenience.
