import { useEffect, useState } from 'react'
import { useAudio } from '../audio/audioContext'

// On-screen playback state machine, shown when the URL hash contains `debug`
// (e.g. https://crates.mycelium-network.io/#debug). Built for on-device / iOS
// Simulator testing: the background/lock-screen playback bugs are invisible in
// a remote debugger you can't keep attached while the phone is locked, so we
// surface the load-bearing state ON the phone. The single most important line
// is FRAMES: `sidecar` = the fast precomputed path (correct); `decode` = the
// fetch-whole-file + decodeAudioData fallback that spikes memory and stalls iOS
// background playback. If you ever see `decode` in catalog mode, the sidecar
// wiring is broken again.
export function DebugHud() {
  const { engine, source, quality } = useAudio()
  // Enable via `?debug` query or `debug` in the hash. Kept separate from the
  // `#enter` hash (which must stay an exact match to auto-enter) so the two can
  // coexist, e.g. `/?debug#enter`.
  const [on] = useState(
    () =>
      typeof window !== 'undefined' &&
      (/(^|[?&])debug\b/.test(window.location.search) ||
        /(^|[#&])debug\b/.test(window.location.hash)),
  )
  const [s, setS] = useState(null)

  useEffect(() => {
    if (!on) return
    const id = setInterval(() => setS(engine.debugState()), 250)
    return () => clearInterval(id)
  }, [on, engine])

  if (!on || !s) return null

  const fmt = (n) => (n && isFinite(n) ? n.toFixed(1) : '0.0')
  const frameColor =
    s.frameSource === 'sidecar' ? '#39ff88'
      : s.frameSource === 'decode' ? '#ff4d4d'
        : s.frameSource === 'pending' ? '#ffd23f'
          : '#8a8a8a'

  const rows = [
    ['SOURCE', source + ' · ' + quality],
    ['STREAM', String(s.isStream)],
    ['FRAMES', s.frameSource + (s.analyzing ? ' (analyzing)' : '') + (s.framesLoaded ? ' ✓' + s.nFrames : '')],
    ['AUDIOEL', (s.elPaused ? 'paused' : 'playing') + (s.elEnded ? ' ENDED' : '')],
    ['TIME', fmt(s.elTime) + ' / ' + (isFinite(s.elDur) && s.elDur ? fmt(s.elDur) : 'known ' + fmt(s.knownDuration))],
    ['CTX', s.ctxState + (s.hidden ? ' · HIDDEN' : '')],
  ]

  return (
    <div
      style={{
        position: 'fixed', top: 8, left: 8, zIndex: 9999,
        font: '11px/1.45 Menlo, Consolas, monospace',
        color: '#e8e8e8', background: 'rgba(6,4,5,0.86)',
        border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6,
        padding: '8px 10px', maxWidth: '72vw', pointerEvents: 'none',
        letterSpacing: '0.02em', backdropFilter: 'blur(3px)',
      }}
    >
      <div style={{ color: '#ff2a1e', fontWeight: 700, marginBottom: 4 }}>CRATE DEBUG</div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 8 }}>
          <span style={{ color: '#8a8a8a', minWidth: 58 }}>{k}</span>
          <span style={{ color: k === 'FRAMES' ? frameColor : '#e8e8e8' }}>{v}</span>
        </div>
      ))}
      <div style={{ color: '#8a8a8a', marginTop: 4 }}>EVENTS</div>
      {s.events.length === 0 && <div style={{ color: '#5a5a5a' }}>—</div>}
      {s.events.map((e, i) => (
        <div key={i} style={{ color: '#bdbdbd' }}>{e}</div>
      ))}
    </div>
  )
}
