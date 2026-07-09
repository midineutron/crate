// Load crate's catalog manifest (same-origin, cookie-authed) and map tracks
// onto the room's screens. Same-origin audio means the Web Audio analyser can
// read it with no CORS setup. Falls back to the demo synth when the catalog is
// unavailable or empty.
import { SCREENS } from '../config/projects'

// Deterministic shuffle so screen->track assignment is stable within a load
// but not just sequential. Seeded by track count.
function shuffled(arr, seed) {
  const a = arr.slice()
  let s = seed || a.length
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export async function loadAssignments() {
  const map = {}
  try {
    const res = await fetch('/manifest.json', { credentials: 'include' })
    if (!res.ok) throw new Error('manifest HTTP ' + res.status)
    const data = await res.json()
    const tracks = (data && data.tracks) || []
    if (tracks.length === 0) throw new Error('empty catalog')
    const pool = shuffled(tracks, tracks.length)
    SCREENS.forEach((s, i) => {
      const t = pool[i % pool.length]
      map[s.screen] = {
        title: (t.title || s.fallback || s.screen).toUpperCase(),
        artist: t.artist || '',
        streamUrl: t.path ? '/' + t.path : null,
        trackId: t.id,
        seed: s.seed,
      }
    })
    return { map, source: 'catalog', count: tracks.length }
  } catch (e) {
    // demo fallback
    SCREENS.forEach((s) => {
      map[s.screen] = { title: s.fallback, artist: '', streamUrl: null, seed: s.seed }
    })
    return { map, source: 'demo', count: 0, error: String(e) }
  }
}
