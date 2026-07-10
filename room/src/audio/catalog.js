// Load crate's catalog manifest (same-origin, cookie-authed) and organize it
// into *projects* — one per CRT. Same-origin audio means the Web Audio analyser
// can read it with no CORS setup. Falls back to a synthesized demo catalog when
// the real one is unavailable or empty.
//
// The manifest has no album field; the project is encoded in the track title as
// "<Project> - <NN Track name>". Titles without " - " are loose singles, which
// we chunk into small playlists so every computer is a real, playable project.
import { SCREENS } from '../config/projects'

const SINGLES_CHUNK = 6 // loose singles per generated playlist

// Deterministic shuffle so the singles->screen spread is stable per load but
// not strictly sequential. Seeded by count.
function shuffled(arr, seed) {
  const a = arr.slice()
  let s = seed || a.length || 1
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function fmtDur(sec) {
  if (!sec || !isFinite(sec)) return ''
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return m + ':' + String(s).padStart(2, '0')
}

// "01 Some Days" -> { num: '01', name: 'Some Days' }; bare title -> { num: '', name }
function splitTrackName(rest) {
  const m = rest.match(/^(\d{1,3})[.\-\s]+(.+)$/)
  if (m) return { num: m[1].padStart(2, '0'), name: m[2].trim() }
  return { num: '', name: rest.trim() }
}

function trackRecord(t, num, name) {
  return {
    id: t.id,
    num,
    name: (name || t.title || 'untitled').toUpperCase(),
    artist: t.artist || '',
    dur: fmtDur(t.duration),
    streamUrl: t.path ? '/' + t.path : null,
  }
}

// Build the ordered list of projects from the raw manifest tracks.
function clusterTracks(tracks) {
  const named = new Map() // project name -> [tracks]
  const loose = []
  for (const t of tracks) {
    const title = t.title || ''
    const idx = title.indexOf(' - ')
    if (idx > 0) {
      const proj = title.slice(0, idx).trim()
      const { num, name } = splitTrackName(title.slice(idx + 3))
      if (!named.has(proj)) named.set(proj, [])
      named.get(proj).push(trackRecord(t, num, name))
    } else {
      loose.push(t)
    }
  }

  const projects = []
  // Named projects first, tracks ordered by their leading number.
  for (const [name, list] of named) {
    list.sort((a, b) => (a.num || '99').localeCompare(b.num || '99'))
    projects.push({ name, kind: 'album', tracks: list })
  }
  // Loose singles -> numbered mini-playlists.
  const spread = shuffled(loose, loose.length)
  for (let i = 0, n = 1; i < spread.length; i += SINGLES_CHUNK, n++) {
    const chunk = spread.slice(i, i + SINGLES_CHUNK)
    projects.push({
      name: 'TRANSMISSION ' + String(n).padStart(2, '0'),
      kind: 'mix',
      tracks: chunk.map((t) => {
        const { num, name } = splitTrackName(t.title || '')
        return trackRecord(t, num || '', name || t.title)
      }),
    })
  }
  return projects
}

// Assign projects onto the fixed screen slots. Extra projects (beyond 12) fold
// their tracks into the last slot so nothing is dropped.
function assign(projects) {
  const byScreen = {}
  const list = []
  const N = SCREENS.length
  const used = projects.slice(0, N)
  const overflow = projects.slice(N)
  for (const [i, s] of SCREENS.entries()) {
    const p = used[i]
    if (!p) continue // no project for this slot -> dark CRT
    const entry = {
      screen: s.screen,
      name: p.name,
      kind: p.kind,
      seed: s.seed,
      tracks: p.tracks,
    }
    byScreen[s.screen] = entry
    list.push(entry)
  }
  if (overflow.length && list.length) {
    const last = list[list.length - 1]
    for (const p of overflow) last.tracks = last.tracks.concat(p.tracks)
  }
  return { byScreen, list }
}

// A self-contained demo catalog so the room is fully explorable offline.
function demoCatalog() {
  const NAMES = [
    ['GHOST SIGNAL', 4], ['NEON DRIFT', 5], ['COLD STORAGE', 3], ['REDLINE', 6],
    ['NULL ROUTE', 4], ['DEEP FIELD', 5], ['STATIC BLOOM', 4], ['LOW ORBIT', 3],
    ['DUSK PROTOCOL', 5], ['HALF LIGHT', 4],
  ]
  const projects = NAMES.map(([name, count], pi) => ({
    name,
    kind: pi % 3 === 0 ? 'album' : 'mix',
    tracks: Array.from({ length: count }, (_, ti) => ({
      id: 'demo-' + pi + '-' + ti,
      num: String(ti + 1).padStart(2, '0'),
      name: ['DRIFT', 'PULSE', 'ECHO', 'FRACTURE', 'HORIZON', 'VAPOR'][ti % 6] + ' ' + (ti + 1),
      artist: '',
      dur: fmtDur(120 + ti * 37 + pi * 11),
      streamUrl: null, // demo synth
    })),
  }))
  return assign(projects)
}

export async function loadAssignments() {
  try {
    const res = await fetch('/manifest.json', { credentials: 'include' })
    if (!res.ok) throw new Error('manifest HTTP ' + res.status)
    const data = await res.json()
    const tracks = (data && data.tracks) || []
    if (tracks.length === 0) throw new Error('empty catalog')
    const { byScreen, list } = assign(clusterTracks(tracks))
    if (list.length === 0) throw new Error('no projects')
    return { byScreen, list, source: 'catalog', count: tracks.length }
  } catch (e) {
    const { byScreen, list } = demoCatalog()
    return { byScreen, list, source: 'demo', count: 0, error: String(e) }
  }
}
