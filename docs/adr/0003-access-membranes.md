# ADR 0003 — Access membranes (radio / member / owner)

**Status:** Accepted. **Refines PRD §8.2 tier table and resolved decision Q1.**
**Date:** 2026-06-26
**Context:** PRD §8.1/§8.2/§8.7, ADR 0002

## Context

The PRD's §8.2 grants anonymous outsiders **on-demand metered streaming**
(Preview tier). That leaks on-demand control — the core value — to people who
never showed up in person, weakening the in-person thesis (§14). We replace the
flat Preview/Full/Abuse tiers with **two physical membranes and a public radio
skin**.

## Decision

### Three access states

| State | How you get it | Interaction | Metering | Offline |
|---|---|---|---|---|
| **Radio** | Default for anyone, no tag | **Non-interactive** broadcast (a station; no track select/search/queue) | **Unmetered** | No |
| **Member** | **Tap a beacon** (presence membrane — "you showed up") | **On-demand** (pick / search / queue) | **Metered** — rolling 30-day window (Q1) | No |
| **Owner** | **Buy a keychain** (ownership membrane — "you bought the record") | On-demand | **Unmetered** | **Yes** + perks |
| *Abuse* | — | Decoy 502 (unchanged) | — | — |

Radio replaces on-demand "Preview." Strangers get a station, not a library.
Metering moves from "limit strangers" to "pressure members toward ownership."

### Two physical objects (PRD Q4/R-COM, Option B)

- **Beacon** — a shared/communal NTAG424 (at a show, poster, venue). **Many
  people scan it.** A tap is a **presence credential** → Member session
  (on-demand, metered). Not ownership; not a bearer of perks.
- **Keychain** — an **individual** NTAG424, sold. **Bearer ownership** of the
  artist's project/catalog → Owner (offline, unlimited, perks, transferable like
  a record per R-COM-2). Optional claim binds it to identity for cross-device.

Both are NTAG424 SDM (CMAC + counter), modeled in **mycelium** as tags /
collections. mycelium proves authenticity and supplies tag identity; **Crate
resolves** which membrane a tag confers (presence vs ownership) from that
identity. Crate does **not** use mycelium content keys. **See ADR 0004.**

### Radio is per-node and artist-curated

- **Per-node stations first.** Each node has its own station; a network-wide
  "dial" across vouched nodes is deferred (see ADR 0002 Q-DIST-MESH / M4).
- The **artist flags which tracks are radio-eligible** (per-track flag in the
  manifest). Radio is non-interactive broadcast: one-to-many, edge-cacheable,
  servable cheaply (incl. via the distribution mesh) — so the free public tier is
  the cheapest to serve, aligning with NFR §10 cost.

### Value gradient

radio (unmetered, non-interactive) → member (on-demand, metered) → owner
(unmetered, offline + perks). A conversion gate at each membrane.

## Consequences

- **Supersedes §8.2 tier semantics and Q1 framing.** Quota applies to *members*,
  not anonymous outsiders; the per-stranger metering-state problem disappears.
- The session model (E2.2) becomes radio/member/owner; tap verification (E2.1)
  is **OAuth proof-of-tap to mycelium**, then **Crate** resolves beacon→presence
  vs keychain→ownership from tag/collection identity (ADR 0004); metering (E2.3)
  applies to member on-demand only. **Radio is host-only — no mycelium.**
- Manifest gains a per-track **radio-eligibility** flag (E1.4/E1.6).
- Commerce/provisioning (E4.3/E4.4) provisions **two SKUs**: beacons (communal
  presence) and keychains (individual ownership bearer).
- Radio doubles as the discovery surface; with the vouch graph it becomes a
  network dial later.

## Open knobs

- Beacon session lifetime / refresh (how long a tap keeps you a member).
- Whether radio is a continuous live stream vs a shuffled on-demand-of-flagged set.
- Network-wide radio dial authoring (deferred — ADR 0002).
