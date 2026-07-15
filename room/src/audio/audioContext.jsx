import { createContext, useContext, useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { AudioEngine } from './AudioEngine'
import { loadAssignments, streamUrlFor } from './catalog'
import { getSavedIndex, saveProject, deleteProject, offlineSupported } from './offlineStore'
import { shades, RED } from '../palette'

const Ctx = createContext(null)

// Fallback lock-screen artwork tile in the project's accent hue, painted when a
// track has no real cover art (demo mode, or an untagged track). Real covers now
// come from Navidrome (track.artUrl -> /rest/getCoverArt); this paints a dark
// radial field tinted with the project colour, "CRATE OS" eyebrow, and the
// project name. Rastered to PNG (iOS Media Session renders SVG unreliably).
// Cached per colour+label.
const artCache = new Map()
function makeArtwork(color, label) {
  if (typeof document === 'undefined') return null
  const key = (color || '') + '|' + (label || '')
  if (artCache.has(key)) return artCache.get(key)
  const S = 512
  const c = document.createElement('canvas')
  c.width = S; c.height = S
  const ctx = c.getContext('2d')
  if (!ctx) return null
  const hue = color || '#ff2a1e'
  ctx.fillStyle = '#0a0607'
  ctx.fillRect(0, 0, S, S)
  const g = ctx.createRadialGradient(S / 2, S * 0.42, 0, S / 2, S * 0.42, S * 0.75)
  g.addColorStop(0, hue)
  g.addColorStop(1, '#0a0607')
  ctx.globalAlpha = 0.55
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  ctx.globalAlpha = 1
  ctx.textAlign = 'center'
  ctx.fillStyle = hue
  ctx.font = '600 30px Menlo, Consolas, monospace'
  ctx.fillText('CRATE OS', S / 2, S * 0.30)
  // Project name, uppercased, truncated to fit.
  let name = String(label || '').toUpperCase()
  ctx.font = '700 68px Menlo, Consolas, monospace'
  while (name.length > 3 && ctx.measureText(name).width > S * 0.86) {
    name = name.slice(0, -1)
  }
  if (name !== String(label || '').toUpperCase() && name.length > 1) {
    name = name.slice(0, -1) + '…'
  }
  ctx.fillStyle = '#f4eaea'
  ctx.fillText(name, S / 2, S * 0.56)
  let url = null
  try { url = c.toDataURL('image/png') } catch (e) { url = null } // tainted-canvas guard
  artCache.set(key, url)
  return url
}

export function AudioProvider({ children }) {
  const engine = useMemo(() => new AudioEngine(), [])

  // Catalog organized into projects (one per CRT).
  const [byScreen, setByScreen] = useState({})
  const [source, setSource] = useState('demo') // 'catalog' | 'demo'
  const [entered, setEntered] = useState(
    () => typeof window !== 'undefined' && window.location.hash === '#enter'
  )

  // Camera focus: which computer the user has zoomed into (null = room view).
  const [focused, setFocused] = useState(null)

  // Playback: { screen, index } of the current track, plus transport state.
  const [active, setActive] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [now, setNow] = useState({ time: 0, duration: 0 }) // control-bar scrubber
  // Streaming quality: 'lossless' (format=raw) or 'lossy' (server-side MP3).
  const [quality, setQualityState] = useState(() => {
    try { const q = localStorage.getItem('crate-quality'); if (q === 'lossy' || q === 'lossless') return q } catch (e) {}
    return 'lossless'
  })

  const byScreenRef = useRef({})
  byScreenRef.current = byScreen
  const qualityRef = useRef(quality)
  qualityRef.current = quality

  // ---- offline saves ----
  // Which projects are downloaded for offline playback (localStorage-backed),
  // plus in-flight progress for the one currently saving.
  const [savedOffline, setSavedOffline] = useState(() => getSavedIndex())
  const [saveProgress, setSaveProgress] = useState(null) // { screen, done, total } | null

  // ---- gyroscope look-around (phones) ----
  const [gyro, setGyro] = useState(false)
  const gyroSupported =
    typeof window !== 'undefined' &&
    typeof window.DeviceOrientationEvent !== 'undefined' &&
    ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0)

  const toggleGyro = useCallback(async () => {
    if (gyro) { setGyro(false); return }
    const DOE = typeof window !== 'undefined' ? window.DeviceOrientationEvent : null
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const res = await DOE.requestPermission()
        if (res !== 'granted') return
      } catch (e) { return }
    }
    setGyro(true)
  }, [gyro])

  // ---- catalog load ----
  const catalogLoaded = useRef(false)
  const loadCatalog = useCallback(async () => {
    if (catalogLoaded.current) return
    catalogLoaded.current = true
    const res = await loadAssignments()
    setByScreen(res.byScreen)
    setSource(res.source)
  }, [])

  const enter = useCallback(async () => {
    await engine.resume()
    await loadCatalog()
    setEntered(true)
  }, [engine, loadCatalog])

  // Deep-link auto-enter (#enter): the veil (and its ENTER click that calls
  // enter()) is skipped, so load the catalog on mount instead -- otherwise the
  // room silently stays in demo-synth mode. No engine.resume() here: the
  // AudioContext needs a user gesture on iOS and streams don't use it anyway;
  // it resumes on the first play tap.
  useEffect(() => {
    if (entered) loadCatalog()
  }, [entered, loadCatalog])

  // ---- transport ----
  const playTrack = useCallback(async (screen, index) => {
    const proj = byScreenRef.current[screen]
    if (!proj || !proj.tracks.length) return
    const i = ((index % proj.tracks.length) + proj.tracks.length) % proj.tracks.length
    const track = proj.tracks[i]
    try {
      setNow({ time: 0, duration: track.durSec || 0 })
      if (track.streamId) await engine.playStream(streamUrlFor(track.streamId, qualityRef.current), track.fftUrl, track.durSec)
      else await engine.playDemo((proj.seed || 0) + i)
      engine.activeId = screen
      setActive({ screen, index: i })
      setPlaying(true)
    } catch (e) {
      console.error('audio play failed', e)
    }
  }, [engine])

  // Debug auto-play (?debug&autoplay): once the catalog is loaded, start the
  // first streamable track automatically. For the iOS Simulator harness
  // (tools/sim-test.sh) so background/lock-screen behaviour can be observed
  // without a manual tap. No-op unless the flag is present. iOS may still
  // require a gesture for the very first play() -- the HUD will show the retry.
  const autoPlayed = useRef(false)
  useEffect(() => {
    if (autoPlayed.current) return
    const dbg = typeof window !== 'undefined' &&
      (/(^|[?&])autoplay\b/.test(window.location.search) ||
        /(^|[#&])autoplay\b/.test(window.location.hash))
    if (!dbg) return
    const firstScreen = Object.keys(byScreen)[0]
    const proj = firstScreen ? byScreen[firstScreen] : null
    if (proj && proj.tracks.some((t) => t.streamId)) {
      autoPlayed.current = true
      const idx = proj.tracks.findIndex((t) => t.streamId)
      playTrack(firstScreen, idx)
    }
  }, [byScreen, playTrack])

  const next = useCallback(() => {
    setActive((a) => {
      if (!a) return a
      playTrack(a.screen, a.index + 1)
      return a
    })
  }, [playTrack])

  const prev = useCallback(() => {
    setActive((a) => {
      if (!a) return a
      // Restart the track if we're past the intro, else go to the previous one.
      if (engine.currentTime > 3) { engine.seek(0); return a }
      playTrack(a.screen, a.index - 1)
      return a
    })
  }, [playTrack, engine])

  const togglePlay = useCallback(async () => {
    if (!active) return
    if (engine.isStream) {
      if (engine.paused) { await engine.play(); setPlaying(true) }
      else { engine.pause(); setPlaying(false) }
    } else {
      // Demo synth can't pause cleanly; toggle acts as stop/restart.
      if (playing) { engine.stopSources(); setPlaying(false) }
      else { playTrack(active.screen, active.index) }
    }
  }, [active, engine, playing, playTrack])

  const seekFrac = useCallback((frac) => {
    if (engine.duration) engine.seek(frac * engine.duration)
  }, [engine])

  // Switch streaming quality; if a stream is playing, reload it at the new
  // format and restore position (frames are unchanged -- same original file).
  const setQuality = useCallback((q) => {
    if (q !== 'lossy' && q !== 'lossless') return
    qualityRef.current = q
    setQualityState(q)
    try { localStorage.setItem('crate-quality', q) } catch (e) {}
    if (engine.isStream && active) {
      const proj = byScreenRef.current[active.screen]
      const track = proj && proj.tracks[active.index]
      if (track && track.streamId) {
        const pos = engine.currentTime
        engine.playStream(streamUrlFor(track.streamId, q), track.fftUrl)
          .then(() => { if (pos > 0.5) engine.seek(pos) })
          .catch(() => {})
      }
    }
  }, [engine, active])

  const stop = useCallback(() => {
    engine.stopSources()
    engine.activeId = null
    engine.isStream = false
    setActive(null)
    setPlaying(false)
    setNow({ time: 0, duration: 0 })
  }, [engine])

  // Download the focused project for offline playback at the CURRENT quality.
  // Progress drives the terminal button; the service worker serves the saved
  // bytes back on playback (no change to playTrack's URLs). No-op mid-save or
  // where the Cache API is unavailable.
  const saveOffline = useCallback(async (screen) => {
    if (!offlineSupported() || saveProgress) return
    const proj = byScreenRef.current[screen]
    if (!proj || !proj.tracks.some((t) => t.streamId)) return
    setSaveProgress({ screen, done: 0, total: proj.tracks.length })
    try {
      await saveProject(proj, qualityRef.current, ({ done, total }) =>
        setSaveProgress({ screen, done, total })
      )
      setSavedOffline(getSavedIndex())
    } catch (e) {
      console.error('offline save failed', e)
    } finally {
      setSaveProgress(null)
    }
  }, [saveProgress])

  const removeOffline = useCallback(async (screen) => {
    await deleteProject(screen)
    setSavedOffline(getSavedIndex())
  }, [])

  const focus = useCallback((screen) => setFocused(screen), [])
  const back = useCallback(() => setFocused(null), [])

  // Auto-advance on track end.
  useEffect(() => { engine.onEnded = next; return () => { engine.onEnded = null } }, [engine, next])

  // Latest transport callbacks, mirrored into refs so the Media Session action
  // handlers below can be registered ONCE and never churn. Re-registering them
  // on every play/pause/track change left a window where a lock-screen skip hit
  // a null handler and was dropped -- the cause of "skip doesn't always
  // register" in the background.
  const togglePlayRef = useRef(togglePlay); togglePlayRef.current = togglePlay
  const nextRef = useRef(next); nextRef.current = next
  const prevRef = useRef(prev); prevRef.current = prev

  // Poll transport time for the scrubber while a stream is playing.
  useEffect(() => {
    if (!playing || !engine.isStream) return
    const id = setInterval(() => {
      setNow({ time: engine.currentTime, duration: engine.duration })
    }, 250)
    return () => clearInterval(id)
  }, [playing, engine, active])

  const activeProject = active ? byScreen[active.screen] : null
  const activeTrack = activeProject ? activeProject.tracks[active.index] : null
  const focusedProject = focused ? byScreen[focused] || null : null

  // ---- Media Session: lock-screen / control-center transport ----
  // Lets the stream (playing through the native <audio> element, so it
  // survives iOS backgrounding) show up with title/artist and hardware
  // play/pause/skip/seek controls. Fully feature-detected -- no-op where
  // Media Session isn't supported.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    if (!activeTrack) {
      navigator.mediaSession.metadata = null
      return
    }
    try {
      const proj = activeProject
      // Real Navidrome cover art when the track carries it; else the painted tile.
      let artwork
      if (activeTrack.artUrl) {
        artwork = [{ src: activeTrack.artUrl, sizes: '512x512', type: 'image/jpeg' }]
      } else {
        const art = makeArtwork(proj && proj.color, proj && proj.name)
        artwork = art ? [{ src: art, sizes: '512x512', type: 'image/png' }] : []
      }
      navigator.mediaSession.metadata = new MediaMetadata({
        title: activeTrack.name || '',
        artist: activeTrack.artist || '',
        album: (proj && proj.name) || '',
        artwork,
      })
    } catch (e) {}
  }, [activeTrack, activeProject])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const handlers = [
      ['play', () => togglePlayRef.current()],
      ['pause', () => togglePlayRef.current()],
      ['previoustrack', () => prevRef.current()],
      ['nexttrack', () => nextRef.current()],
      ['seekto', (details) => {
        if (details && typeof details.seekTime === 'number') engine.seek(details.seekTime)
      }],
    ]
    for (const [action, handler] of handlers) {
      try { ms.setActionHandler(action, handler) } catch (e) {} // unsupported action type
    }
    return () => {
      for (const [action] of handlers) {
        try { ms.setActionHandler(action, null) } catch (e) {}
      }
    }
    // Registered once and left in place (handlers read latest via refs) so a
    // background skip never lands on a torn-down handler.
  }, [engine])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused' } catch (e) {}
  }, [playing])

  // Feed the lock-screen scrubber. `now` is polled every 250ms while a stream
  // plays; mirror it into positionState so iOS shows elapsed/remaining + a seek
  // bar. Guard against the invalid states setPositionState throws on.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    if (typeof navigator.mediaSession.setPositionState !== 'function') return
    const { time, duration } = now
    try {
      if (duration > 0 && isFinite(duration)) {
        navigator.mediaSession.setPositionState({
          duration,
          position: Math.max(0, Math.min(time || 0, duration)),
          playbackRate: 1,
        })
      } else {
        navigator.mediaSession.setPositionState() // clear when duration unknown
      }
    } catch (e) {}
  }, [now])

  // ---- resume the demo AudioContext when the tab/app comes back to the
  // foreground (iOS/Safari suspend it while hidden; streams are unaffected
  // since they play through the native <audio> element, not this context). ----
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => {
      // Only the demo synth needs the context live. Resuming it during a stream
      // would hand the iOS audio session back to Web Audio and kill the
      // element's lock-screen Now Playing card.
      if (!document.hidden && !engine.isStream && engine.ctx && engine.ctx.state === 'suspended') {
        engine.ctx.resume().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [engine])

  // Global room accent: the focused TV's colour (immediate on select), then the
  // playing TV's, else the default red. Drives the CSS variables every themed
  // surface reads from, plus the 3D lights/fog.
  const accent = (focusedProject && focusedProject.color) ||
    (activeProject && activeProject.color) || RED
  useEffect(() => {
    const p = shades(accent)
    const r = document.documentElement.style
    r.setProperty('--accent', p.main)
    r.setProperty('--accent-mid', p.mid)
    r.setProperty('--accent-dim', p.dim)
    r.setProperty('--accent-rgb', p.rgb)
  }, [accent])

  const value = useMemo(
    () => ({
      engine, source, entered, enter,
      byScreen, focused, focus, back, focusedProject,
      active, activeProject, activeTrack, playing, now, accent,
      playTrack, togglePlay, next, prev, seekFrac, stop,
      gyro, gyroSupported, toggleGyro,
      quality, setQuality,
      savedOffline, saveProgress, saveOffline, removeOffline,
    }),
    [engine, source, entered, enter, byScreen, focused, focus, back, focusedProject,
     active, activeProject, activeTrack, playing, now, accent,
     playTrack, togglePlay, next, prev, seekFrac, stop,
     gyro, gyroSupported, toggleGyro, quality, setQuality,
     savedOffline, saveProgress, saveOffline, removeOffline]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAudio = () => useContext(Ctx)
