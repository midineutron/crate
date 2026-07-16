// CRATE offline service worker.
//
// Enables true offline: the room shell loads with no network, and any project
// the user explicitly "saved offline" plays back from local storage. Replaces
// the old tombstone SW (which only retired a legacy PWA).
//
// Three caches, each with a distinct policy:
//   - SHELL   (app shell: index.html + hashed /assets + room.glb)  network-first
//             nav, stale-while-revalidate assets. Online users always get fresh
//             code; offline users get whatever they last loaded.
//   - CATALOG (Subsonic JSON: getAlbumList2 / getAlbum)  stale-while-revalidate,
//             so loadAssignments() can rebuild the project list with no network.
//   - MEDIA   (saved streams / .fft sidecars / cover art)  cache-first. The PAGE
//             writes this cache (offlineStore.js); the SW only reads it. A saved
//             stream is keyed by track id (not the format query param) so a
//             project saved as lossy still serves when the quality toggle is
//             lossless, and vice-versa.
//
// Everything else (live /rest JSON, cross-origin) passes straight through to the
// network so auth and Cloudflare behave exactly as without a SW.

const VERSION = 'v1'
const SHELL_CACHE = 'crate-shell-' + VERSION
const CATALOG_CACHE = 'crate-catalog-' + VERSION
const MEDIA_CACHE = 'crate-offline-v1' // shared with offlineStore.js — keep in sync
const KEEP = new Set([SHELL_CACHE, CATALOG_CACHE, MEDIA_CACHE])

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop every cache that isn't one of ours (old PWA/tombstone caches, and
    // previous-version SHELL/CATALOG caches). MEDIA is version-pinned so saved
    // projects survive SW upgrades.
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => (KEEP.has(k) ? null : caches.delete(k))))
    await self.clients.claim()
  })())
})

// Normalize a saved-media request to its cache key. Stream requests collapse to
// a format-agnostic key by track id; sidecar + cover art match by exact URL.
function mediaKey(url) {
  const u = new URL(url)
  if (u.pathname === '/rest/stream.view') {
    return self.location.origin + '/offline-stream/' + (u.searchParams.get('id') || '')
  }
  return url
}

function isMediaPath(p) {
  return p === '/rest/stream.view' || p.startsWith('/audio/') || p === '/rest/getCoverArt.view'
}

// Serve a saved media response, honouring Range requests (audio elements issue
// them for seeking; the cached body is a full 200, so slice it into a 206).
async function serveMedia(request) {
  const cache = await caches.open(MEDIA_CACHE)
  const cached = await cache.match(mediaKey(request.url))
  if (!cached) return null
  const range = request.headers.get('range')
  if (!range) return cached
  const buf = await cached.arrayBuffer()
  const total = buf.byteLength
  const m = /bytes=(\d*)-(\d*)/.exec(range)
  let start = m && m[1] ? parseInt(m[1], 10) : 0
  let end = m && m[2] ? parseInt(m[2], 10) : total - 1
  if (m && m[1] === '' && m[2]) { start = Math.max(0, total - parseInt(m[2], 10)); end = total - 1 } // suffix range
  if (!Number.isFinite(start) || start < 0) start = 0
  if (!Number.isFinite(end) || end >= total) end = total - 1
  if (start >= total || start > end) {
    // Unsatisfiable range (RFC 7233 416) rather than a malformed 206.
    return new Response(null, {
      status: 416,
      statusText: 'Range Not Satisfiable',
      headers: { 'Content-Range': 'bytes */' + total },
    })
  }
  const chunk = buf.slice(start, end + 1)
  const headers = new Headers(cached.headers)
  headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + total)
  headers.set('Content-Length', String(chunk.byteLength))
  headers.set('Accept-Ranges', 'bytes')
  return new Response(chunk, { status: 206, statusText: 'Partial Content', headers })
}

// Network-first for navigations; fall back to the cached shell offline. The
// canonical index is stored under '/' so any deep link resolves offline.
async function networkFirstNav(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const net = await fetch(request)
    if (net && net.ok) cache.put('/', net.clone())
    return net
  } catch (e) {
    return (await cache.match('/')) || (await cache.match(request)) || Response.error()
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const net = fetch(request)
    .then((res) => { if (res && res.ok) cache.put(request, res.clone()); return res })
    .catch(() => null)
  return cached || (await net) || Response.error()
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // cross-origin: browser default
  const p = url.pathname

  if (isMediaPath(p)) {
    event.respondWith((async () => (await serveMedia(req)) || fetch(req))())
    return
  }
  if (p === '/rest/getAlbumList2.view' || p === '/rest/getAlbum.view') {
    event.respondWith(staleWhileRevalidate(req, CATALOG_CACHE))
    return
  }
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstNav(req))
    return
  }
  if (p.startsWith('/assets/') || p === '/room.glb' || /\.(js|mjs|css|woff2?|ttf|png|jpe?g|svg|wasm|json|glb|webmanifest)$/.test(p)) {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE))
    return
  }
  // Live /rest JSON (ping, getCoverArt is handled above as media) + anything
  // else: passthrough. Not cached — needs live auth.
})
