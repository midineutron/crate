import { createContext, useContext, useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { AudioEngine } from './AudioEngine'
import { loadAssignments } from './catalog'

const Ctx = createContext(null)

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

  const byScreenRef = useRef({})
  byScreenRef.current = byScreen

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

  // ---- catalog load on enter ----
  const enter = useCallback(async () => {
    await engine.resume()
    const res = await loadAssignments()
    setByScreen(res.byScreen)
    setSource(res.source)
    setEntered(true)
  }, [engine])

  // ---- transport ----
  const playTrack = useCallback(async (screen, index) => {
    const proj = byScreenRef.current[screen]
    if (!proj || !proj.tracks.length) return
    const i = ((index % proj.tracks.length) + proj.tracks.length) % proj.tracks.length
    const track = proj.tracks[i]
    try {
      if (track.streamUrl) await engine.playStream(track.streamUrl)
      else await engine.playDemo((proj.seed || 0) + i)
      engine.activeId = screen
      setActive({ screen, index: i })
      setPlaying(true)
    } catch (e) {
      console.error('audio play failed', e)
    }
  }, [engine])

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

  const stop = useCallback(() => {
    engine.stopSources()
    engine.activeId = null
    engine.isStream = false
    setActive(null)
    setPlaying(false)
    setNow({ time: 0, duration: 0 })
  }, [engine])

  const focus = useCallback((screen) => setFocused(screen), [])
  const back = useCallback(() => setFocused(null), [])

  // Auto-advance on track end.
  useEffect(() => { engine.onEnded = next; return () => { engine.onEnded = null } }, [engine, next])

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

  const value = useMemo(
    () => ({
      engine, source, entered, enter,
      byScreen, focused, focus, back, focusedProject,
      active, activeProject, activeTrack, playing, now,
      playTrack, togglePlay, next, prev, seekFrac, stop,
      gyro, gyroSupported, toggleGyro,
    }),
    [engine, source, entered, enter, byScreen, focused, focus, back, focusedProject,
     active, activeProject, activeTrack, playing, now,
     playTrack, togglePlay, next, prev, seekFrac, stop,
     gyro, gyroSupported, toggleGyro]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAudio = () => useContext(Ctx)
