# ADR 0002 — Distribution and participant roles

**Status:** Accepted direction. **Near-term decisions are binding;** the features
themselves are deferred (post-M3, partly under discussion).
**Date:** 2026-06-25
**Context:** PRD §8.1/§8.2/§8.6/§9, Roadmap, ADR 0001

## Context

Two long-horizon concepts pressure the architecture now even though they ship
later:

1. **Roles** — beyond artist + fan, a **DJ/curator** publishes mixes/playlists
   that *reference* tracks living in other origin crates.
2. **Distribution** — a stream need not come from a track's origin node; a mesh
   of nodes holding the music can serve the closest / strongest connection, so a
   solo artist's node is not the bandwidth ceiling ("streaming at scale").

We want these to scale **without** moving authority off the origin artist.

## Decisions — binding now (load-bearing)

These constrain M1–M3 design even though dependent features are later.

1. **Identity is universal.** The base participant is a **listener**; every
   participant has one mycelium-rooted identity. **Artist, DJ/curator, and
   provider are additive role grants** on that identity, not distinct user types.
   (Generalizes MYC-1 beyond artists.)

2. **Content-addressed tracks.** Every track has a **stable content-hash ID** in
   `manifest.json` and `crate.bundle`. References (mixes) and replicas (mesh) are
   then location-independent and tamper-evident. (Constrains E1.4 manifest schema
   and E3.1 bundle; the bundle already hashes content per R-PORT-5.)

3. **Authority invariant.** Playback/entitlement authority **always resolves to
   the track's origin artist** (their mycelium), regardless of which node curates
   a mix or serves the bytes. Entitlement tokens are JWKS-verifiable offline at
   any node (R-ID-3a generalizes to peers — a serving node validates a listener's
   token against the origin's JWKS without the origin online).

4. **Metering boundary at the token/authority layer.** Quota accounting is scoped
   to the entitlement token / authority, **not solely node-local Redis**, so it
   survives distributed serving and future earned-credit. v1 may implement
   node-local, but the boundary is defined at the authority layer. (Constrains
   E2.3 + MYC-2.)

5. **Replication is pull-based, gated by a signed grant.** A node may cache and
   re-serve another artist's masters only under a **signed, revocable,
   content-scoped grant** from the origin. Pull (a node that legitimately served a
   track may re-serve under a standing grant) over push — better scaling, and it
   matches the physical "the music came to you" relationship. The grant is the
   consent gate that keeps the §9 "host retains/redistributes after departure"
   threat closed in a mesh. (Extends MYC-5/6 signing.)

## Deferred / under discussion (keep talking)

- **Reference-based mixes + DJ role features.** A mix = a signed list of
  `{home-node, track-content-hash}`; playback resolves each reference against the
  home crate's entitlement; offline-caches only fully-entitled tracks.
- **Serving mesh + node selection — leaning hybrid.** Index-assisted *discovery*
  (label index / vouch graph as bootstrap and hints) + **P2P/direct serving**
  (index out of the data path, so a node stays up if the index is down, per §10).
  DHT/gossip as an index-independent fallback. Open: how much coordination vs pure
  P2P.
- **Provider-credit economy.** On hitting a listen limit, a listener may **become
  a provider node** (serve others) to earn more listening / offline access, or
  **pay the artist directly to own** the track. Reinforces decision #4 (metering
  must live at the authority so quota can be *earned*, not only spent). Open:
  credit accounting, abuse resistance, artist payout.

## Now-vs-later

| Concern | Decide/design now | Build later |
|---|---|---|
| Identity | universal listener identity + additive roles (MYC-1) | DJ/provider role UIs |
| Track ID | content-addressed hash in manifest + bundle (E1.4, E3.1) | reference-based mixes |
| Authority | origin-resolves invariant; tokens verifiable at any node | cross-node verification at mesh scale |
| Metering | quota boundary at token/authority layer (E2.3, MYC-2) | earned/provider credit ledger |
| Replication | signed revocable content-scoped grant primitive | the serving mesh + node selection |

## Consequences

- All five "now" decisions are extensions of existing PRD primitives
  (content-hash bundles, JWKS edge verification, signed vouches) — not new
  foundations. The architecture absorbs distribution and roles later without a
  rewrite.
- Defining the metering boundary at the authority layer is the one near-term
  design cost; it is what makes both distributed serving and the provider-credit
  economy possible without re-plumbing.
