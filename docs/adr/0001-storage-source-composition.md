# ADR 0001 — Storage source composition

**Status:** Accepted (direction); implementation phased
**Date:** 2026-06-25
**Context:** PRD §8.3 (data layer), Roadmap Q-STORAGE, M1/M3

## Context

The PRD assumes a single storage **origin** per node (one rclone remote, cloud-first).
Real deployment tiers want more: an appliance (Pi / old PC) should run plug-and-play
from a **local disk or USB** with no cloud account, while cloud and label tiers want a
cloud origin — and an artist may want several of these **at the same time** (e.g. a USB
origin mirrored to cloud for backup and remote reachability). Artists may also upload
audio **through the web interface**, which is a write that must land somewhere.

## Decision

Model node storage as a **composable set of sources**, not a single origin.

- **Source types:** local disk · removable USB · cloud remote (Drive / Dropbox / S3 /
  MinIO / NAS). All via one rclone code path.
- **Selectable mount:** any single source can back the application.
- **Composition:** multiple sources merge into one logical catalog via rclone
  `union` / `combine`.
- **Per-source role:** `origin` (authoritative) · `mirror`/`replica` · `cache`.
- **Authority (Q-STORAGE #1):** when sources hold the same track, the winner is
  decided by **artist-configured per-source priority**. The highest-priority source
  holding a file is authoritative.
- **Write target:** one source is designated the **write/upload destination** (rclone
  union create-policy). In-interface uploads and the ingest watcher write here.
- **Sync policy (Q-STORAGE #2):** **opinionated default with user override.** The
  product suggests a strong default (e.g. one-way backup local→cloud) but the artist
  may choose: one-way backup · two-way mirror · independent (unioned, no sync). The
  system is opinionated, not prescriptive.

### Migration implication (M3)
A node migrates by **re-pointing its source set**:
- Any reachable cloud source present → new host rebuilds **by reference** (no media).
- Only local/USB → migration is **by copy** (move bytes).
- Mixed → local-first for plug-and-play *and* cloud mirror for portability + backup.

This generalizes the portability fork instead of forcing one model.

### R-DL-1 restatement
"Fans are served from the host-served tree (local/cache), never from a **remote
consumer drive** directly." Holds whether the host is a Pi with a USB or a cloud VM.

## Phasing (Q-STORAGE #3)

- **M1:** build the **source abstraction**; ship **single selectable source**
  (local / USB / cloud). Covers appliance + cloud tiers. In-interface upload targets
  the single source.
- **M3 (E3.4):** **multi-source composition** — rclone union, per-source priority,
  write-target designation, opinionated-default sync with override. Lands alongside
  migration, where the authority question is forced anyway.

The abstraction is identical in both phases, so multi-source is an extension, not a
retrofit.

## Consequences

- One rclone code path serves every tier (no lock-in, no fork).
- Conflict/authority logic is deferred to M3 but designed for in M1.
- Two-way mirror invites edit conflicts; mitigated by per-source priority + an
  opinionated default that steers most users to one-way backup.
- "Crate is a folder" legibility is preserved per-source; the union view is a host
  concern, not something the artist must reason about unless they opt into multi-source.

## Open knobs (not blocking)

- Default sync policy specifics and conflict-resolution UX.
- Union create-policy details (e.g. most-free-space vs pinned write source).
- Hot-plug detection UX for USB insert/removal.
