# ADR 0006 — Listener-first, composable roles, three-tier access

**Status:** Accepted. **Reframes** the project from "artist-first" to
"listener-first." **Extends** ADR 0002 (roles), **refines** ADR 0003 (membranes).
**Date:** 2026-06-27

## Context

The project had been framed artist-first, with the DJ and the access tiers treated
as secondary. Two realizations change the direction:

1. **The listener is the base.** Every participant is a listener; artist, DJ,
   broadcaster, and label are roles grown on top of one sovereign listener
   identity. Everyone is a *potential* node.
2. **The DJ is first-class** — a curator and discovery point, not an afterthought —
   and the three-tier physical access model is a fundamental pillar, not a detail.

The technical foundation (universal identity, content-addressing,
authority-resolves-to-origin, distribution mesh, metering-at-authority) already
supports this; what changes is positioning, role priority, and one elevated
primitive (the mix).

## Decision

### 1. Listener-first; nodes are role-activated
The **listener** is the base identity: portable, sovereign, **a client by
default**. A participant **materializes a node** when they take on a role that
hosts. Everyone *can* be a node; not everyone *is* one until they opt in.

### 2. Roles are additive AND composable
A single identity can hold several roles at once (e.g. **artist + DJ +
broadcaster**). Roles:

- **Listener (base).** Consumer/client; owns or holds membership to crates.
- **Broadcaster / Provider (opt-in).** Provides resources to the network —
  replication and an additional source to pull audio from — and earns perks for
  it. **This is how a listener becomes a node.**
- **DJ.** Active listener, curator, and **discovery point** that routes listeners
  to artist crates; subscribable. Dual-mode (below).
- **Artist.** Publishes a catalog of **entirely their own original work** (owns
  the masters). An artist crate is original ownership by assumption.
- **Label.** Manages a collection of crates.

### 3. The DJ has two modes (this solves cold-start)
- **Private collection (works day one).** A DJ uploads their own crate of music
  and shares it **privately, keychain-gated** — the digital form of *lending your
  crate of records to whoever holds the key*. Needs no network; this is the
  original Crate intent and the cold-start wedge.
- **Public reference-mixes (scale with the network).** A **mix is a first-class
  object** — a signed, content-addressed list of `{origin-crate, track-hash}` —
  peer to a track. It references tracks in their **origin artist crates**; each
  play resolves against that track's origin membrane and authority. References,
  not copies.

### 4. Three-tier access is a fundamental, for every crate owner
Applies to artist, label, and DJ crates alike:

| Tier | Entry | Access |
|---|---|---|
| **Radio** | Visit digitally from outside the network | The owner's **radio** (artist/label/DJ radio) — non-interactive, public, **broadcast-like** |
| **Member** | **Scan a beacon (an NFC tag type) in person** | Inside the network: limited, gated access |
| **Owner** | **Buy a keychain (an NFC tag type)** | Full access to **whatever the crate owner defines** |

- **Beacon** and **keychain** are both **NFC tag types**; the beacon is the
  in-person **tier-2 entry point** (scanned by many), the keychain is the
  individual **tier-3 ownership** token.
- **Keychain scope is owner-defined and arbitrary:** a single project run, a full
  discography, a DJ's mixes, a DJ's private collection, a special edition.

### 5. Rights posture (stated explicitly)
- **Artist crate = the artist's own original work** by assumption (original
  masters, original ownership).
- **DJ private collection = lending,** not publishing: gated, limited, paid
  keychain runs — like lending a physical crate of records. Crate does **not**
  host public copies of others' work.
- **Radios are broadcast-like** (non-interactive), which aligns the public tier
  with broadcast norms. **Public DJ mixes are references, not copies.**

## Sequencing (cold-start)
Lead with what works on an empty network: **solo crate owner + keychain + radio**
(an artist with their catalog, or a DJ with a private collection). Layer
**beacons/in-person presence** and the **public reference-mix network + DJ
discovery graph** as density grows.

## Consequences
- **Node generalizes** from "one artist's instance" to "a participant's
  role-activated instance" (catalog, mixes, broadcast, and/or identity+library).
- **Discovery = artist vouch graph + DJ curation graph** (subscribe to a DJ).
  Still human-curated, not algorithmic (NG2 holds).
- **The mix moves from deferred to first-class** in the manifest/bundle.
- Foundation unchanged; this is generalization, not a teardown.

## Supersedes / refines
- **Positioning:** "artist-first" → "listener-first; artist/DJ/broadcaster/label
  are composable roles."
- **ADR 0003:** membranes apply to **all** crate owners; keychain scope is
  owner-defined; beacon named as the NFC tier-2 entry; PRD §8.2 preview/full is
  replaced by radio/member/owner.
- **ADR 0002:** reference-mixes and the provider role are promoted from deferred
  to first-class (mix object now; broadcaster designed-in).

## The distinction it all hangs on
Incumbents (Spotify, SoundCloud, Bandcamp, YouTube) differ in UX and which role
they flatter, but are identical in **data topology — centralized, platform-owned.**
Crate's difference is the topology itself: **references, not copies; participants
hold their own root.** Every role inherits from that.
