// Page-side offline storage for whole projects.
//
// "Save project offline" downloads every asset a project needs to play with no
// network — the audio stream, the precomputed .fft visualizer sidecar, and the
// cover art — into the Cache API. The service worker (public/sw.js) reads this
// cache back on playback, so nothing here rewrites playback URLs: the room plays
// the same /rest/stream URLs and the SW transparently serves the saved bytes.
//
// A small metadata index in localStorage tracks what's saved (name, quality,
// track count, byte size, the cache keys to delete) so the terminal UI can show
// SAVED / a size readout and remove a project without the live catalog.

import { streamUrlFor } from './catalog'

const MEDIA_CACHE = 'crate-offline-v1' // must match sw.js
const INDEX_KEY = 'crate-offline-index'

export function offlineSupported() {
  return (
    typeof window !== 'undefined' &&
    'caches' in window &&
    'serviceWorker' in navigator
  )
}

// Format-agnostic cache key for a saved stream, keyed by track id (mirrors
// mediaKey() in sw.js) so playback at any quality resolves the saved copy.
function streamKey(id) {
  return window.location.origin + '/offline-stream/' + id
}

export function getSavedIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch (e) {
    return {}
  }
}

function writeIndex(idx) {
  try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)) } catch (e) {}
}

export function isSaved(screen) {
  return !!getSavedIndex()[screen]
}

// Enumerate the unique assets a project needs offline: one stream per streamable
// track (keyed by id), plus each distinct .fft sidecar and cover-art URL.
function projectAssets(project, quality) {
  const assets = []
  const seen = new Set()
  const add = (key, url) => {
    if (!url || seen.has(key)) return
    seen.add(key)
    assets.push({ key, url })
  }
  for (const t of project.tracks) {
    if (!t.streamId) continue
    add(streamKey(t.streamId), streamUrlFor(t.streamId, quality))
    if (t.fftUrl) add(t.fftUrl, t.fftUrl)
    if (t.artUrl) add(t.artUrl, t.artUrl)
  }
  return assets
}

function isStreamKey(k) {
  return k.indexOf('/offline-stream/') !== -1
}

// Guard against caching an auth challenge / login page as if it were media: the
// crate origin is behind a session-cookie gate (and Cloudflare), so an expired
// session makes fetch() resolve to a 200 HTML page. Reject HTML, redirects, and
// non-audio bodies for stream assets.
function isRealAsset(res, key) {
  if (!res || !res.ok || res.redirected) return false
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  if (ct.indexOf('text/html') !== -1) return false
  if (isStreamKey(key) && ct && ct.indexOf('audio/') !== 0) return false
  return true
}

// Download a project into the offline cache. Resumable: assets already cached
// are kept, so re-running after an interruption fills only the gaps.
// `onProgress({done, total})` fires after each asset. Resolves with a summary
// (including `partial` when not every track landed); rejects only if NO audio
// was saved. The localStorage index is written incrementally so an interrupted
// save never orphans cached bytes — deleteProject() can always find them.
export async function saveProject(project, quality, onProgress) {
  if (!offlineSupported()) throw new Error('offline unsupported')
  // Ask the browser not to evict our storage under pressure. Best-effort.
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist() } catch (e) {}

  const assets = projectAssets(project, quality)
  const expected = project.tracks.filter((t) => t.streamId).length
  const cache = await caches.open(MEDIA_CACHE)
  const keys = []
  // Progress is counted in TRACKS, not assets: each track pulls a stream plus
  // optional fft/art sidecars, so an asset-based total (e.g. 29 for 14 tracks)
  // reads as wrong next to the track list. Tick once per stream asset.
  let tracksDone = 0
  let bytes = 0

  // Provisional index entry up front so an interruption leaves a removable
  // (partial) record rather than orphaned cache bytes.
  const idx = getSavedIndex()
  idx[project.screen] = {
    name: project.name, quality, trackCount: 0, expected,
    bytes: 0, savedAt: Date.now(), partial: true, keys,
  }
  writeIndex(idx)
  if (onProgress) onProgress({ done: 0, total: expected })

  const commit = (key, size) => {
    if (keys.indexOf(key) === -1) keys.push(key)
    bytes += size
    idx[project.screen].bytes = bytes
    idx[project.screen].keys = keys.slice()
    writeIndex(idx)
  }

  for (const a of assets) {
    try {
      const existing = await cache.match(a.key)
      if (existing) {
        commit(a.key, Number(existing.headers.get('content-length')) || 0)
      } else {
        const res = await fetch(a.url, { credentials: 'include' })
        if (isRealAsset(res, a.key)) {
          await cache.put(a.key, res.clone())
          commit(a.key, Number(res.headers.get('content-length')) || 0)
        }
      }
    } catch (e) {
      // Tolerate individual asset failures (a missing sidecar still plays; the
      // visualizer falls back). A total audio failure is caught below.
    }
    // Advance the track counter only on stream assets so progress tracks tracks,
    // not sidecars — sidecars/art land silently between ticks.
    if (isStreamKey(a.key)) {
      tracksDone++
      if (onProgress) onProgress({ done: tracksDone, total: expected })
    }
  }

  const streamsSaved = keys.filter(isStreamKey).length
  if (streamsSaved === 0) {
    // Nothing playable landed — roll back so we don't show a broken SAVED state.
    await Promise.all(keys.map((k) => cache.delete(k).catch(() => {})))
    const clean = getSavedIndex()
    delete clean[project.screen]
    writeIndex(clean)
    throw new Error('no tracks saved')
  }

  idx[project.screen] = {
    ...idx[project.screen],
    trackCount: streamsSaved,
    expected,
    bytes,
    partial: streamsSaved < expected,
  }
  writeIndex(idx)
  return idx[project.screen]
}

// Remove a saved project: drop its cached assets and its index entry.
export async function deleteProject(screen) {
  const idx = getSavedIndex()
  const entry = idx[screen]
  if (entry && offlineSupported()) {
    try {
      const cache = await caches.open(MEDIA_CACHE)
      await Promise.all((entry.keys || []).map((k) => cache.delete(k).catch(() => {})))
    } catch (e) {}
  }
  delete idx[screen]
  writeIndex(idx)
}
