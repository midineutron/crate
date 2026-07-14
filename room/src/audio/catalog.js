// Load crate's catalog from Navidrome via the Subsonic REST API (same-origin,
// cookie-authed) and organize it into *projects* — one per CRT. Same-origin
// means the Web Audio analyser and the native <audio> element read it with no
// CORS setup. Falls back to a synthesized demo catalog when the backend is
// unavailable or empty.
//
// Structure now comes from tags, not a title-string hack: each Subsonic *album*
// (its `Album` / `Album Artist` tags) is one project on one CRT, its songs
// ordered by disc + track number. See GitHub #11 (streaming architecture) and
// #14 (tagging conventions).
//
// Auth is injected server-side: crate-web (nginx) reverse-proxies /rest/* to
// Navidrome and asserts a fixed `Remote-User` identity, so the browser carries
// NO Subsonic credential (no salt/token/password) — only the session cookie via
// `credentials: 'include'`. We still send the mandatory Subsonic params
// (u/v/c/f). `u` matches the injected identity.
import { SCREENS } from '../config/projects'

const API_VERSION = '1.16.1'
const CLIENT = 'crate'
const USER = 'crate' // matches the Remote-User identity injected at the gate

// Build a /rest/ URL. JSON endpoints get f=json; binary endpoints (stream,
// cover art) must omit it. Auth params are intentionally absent — the gate
// injects identity.
function restUrl(view, params = {}, { binary = false } = {}) {
  const q = new URLSearchParams({ u: USER, v: API_VERSION, c: CLIENT, ...params })
  if (!binary) q.set('f', 'json')
  return '/rest/' + view + '.view?' + q.toString()
}

async function restJson(view, params) {
  const res = await fetch(restUrl(view, params), { credentials: 'include' })
  if (!res.ok) throw new Error(view + ' HTTP ' + res.status)
  const body = await res.json()
  const sub = body && body['subsonic-response']
  if (!sub || sub.status !== 'ok') {
    const msg = sub && sub.error ? sub.error.message : 'error'
    throw new Error(view + ' subsonic: ' + msg)
  }
  return sub
}

function fmtDur(sec) {
  if (!sec || !isFinite(sec)) return ''
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return m + ':' + String(s).padStart(2, '0')
}

// One Subsonic song -> a track record. `album` supplies cover art fallback when
// the song carries none. Stream is format=raw (untranscoded) so the decoded FFT
// frame timeline matches audioEl.currentTime exactly — load-bearing (#11).
function trackRecord(s, album) {
  const coverId = s.coverArt || (album && album.coverArt) || null
  return {
    id: s.id,
    num: s.track != null ? String(s.track).padStart(2, '0') : '',
    name: (s.title || 'untitled').toUpperCase(),
    artist: s.artist || '',
    dur: fmtDur(s.duration),
    streamUrl: restUrl('stream', { id: s.id, format: 'raw' }, { binary: true }),
    artUrl: coverId
      ? restUrl('getCoverArt', { id: coverId, size: '512' }, { binary: true })
      : null,
  }
}

// getAlbumList2 -> albums (metadata only, no songs).
async function fetchAlbums() {
  const sub = await restJson('getAlbumList2', {
    type: 'alphabeticalByName',
    size: '500',
  })
  return (sub.albumList2 && sub.albumList2.album) || []
}

// getAlbum -> one album with its songs.
async function fetchAlbum(id) {
  const sub = await restJson('getAlbum', { id })
  return sub.album || null
}

// Albums -> ordered projects (one per album). Song lists fetched in parallel;
// an album that fails to load is skipped rather than sinking the whole catalog.
async function albumsToProjects(albums) {
  const detailed = await Promise.all(
    albums.map((a) => fetchAlbum(a.id).catch(() => null)),
  )
  const projects = []
  for (const album of detailed) {
    if (!album) continue
    const songs = album.song || []
    if (!songs.length) continue
    songs.sort(
      (a, b) =>
        (a.discNumber || 0) - (b.discNumber || 0) || (a.track || 0) - (b.track || 0),
    )
    projects.push({
      name: (album.name || 'untitled').toUpperCase(),
      kind: 'album',
      tracks: songs.map((s) => trackRecord(s, album)),
    })
  }
  return projects
}

// Assign projects onto the fixed screen slots. Extra projects (beyond the slot
// count) fold their tracks into the last slot so nothing is dropped. seed and
// color come from SCREENS, not the catalog.
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
      color: s.color,
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
      artUrl: null, // generated tile
    })),
  }))
  return assign(projects)
}

export async function loadAssignments() {
  try {
    const albums = await fetchAlbums()
    if (albums.length === 0) throw new Error('empty catalog')
    const projects = await albumsToProjects(albums)
    const { byScreen, list } = assign(projects)
    if (list.length === 0) throw new Error('no projects')
    const count = list.reduce((n, e) => n + e.tracks.length, 0)
    return { byScreen, list, source: 'catalog', count }
  } catch (e) {
    const { byScreen, list } = demoCatalog()
    return { byScreen, list, source: 'demo', count: 0, error: String(e) }
  }
}
