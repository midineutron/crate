import { useAudio } from '../audio/audioContext'

function fmt(sec) {
  if (!sec || !isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return m + ':' + String(s).padStart(2, '0')
}

// The terminal that appears over the focused CRT: project header + track list.
function Terminal() {
  const { focusedProject, focused, active, playing, playTrack, back } = useAudio()
  if (!focusedProject) return null
  const proj = focusedProject
  return (
    <div className="terminal">
      <div className="term-scan" />
      <div className="term-head">
        <span className="term-os">CRATE OS</span>
        <span className="term-kind">{proj.kind === 'album' ? 'ALBUM' : 'MIX'}</span>
      </div>
      <div className="term-title">{proj.name}</div>
      <div className="term-rows">
        {proj.tracks.map((t, i) => {
          const isActive = active && active.screen === focused && active.index === i
          return (
            <button
              key={t.id || i}
              className={'term-row' + (isActive ? ' active' : '')}
              onClick={() => playTrack(focused, i)}
            >
              <span className="tr-mark">{isActive ? (playing ? '▶' : '❚❚') : t.num || '··'}</span>
              <span className="tr-name">{t.name}</span>
              <span className="tr-dur">{t.dur}</span>
            </button>
          )
        })}
      </div>
      <div className="term-foot">
        <button className="term-back" onClick={back}>◀ BACK</button>
        <span className="term-count">{proj.tracks.length} TRACKS</span>
      </div>
    </div>
  )
}

// Persistent transport bar; visible whenever something is loaded.
function Transport() {
  const { active, activeProject, activeTrack, playing, now, togglePlay, next, prev, seekFrac, stop } = useAudio()
  if (!active || !activeTrack) return null
  const frac = now.duration ? Math.min(1, now.time / now.duration) : 0
  const onScrub = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    seekFrac((e.clientX - r.left) / r.width)
  }
  return (
    <div className="transport">
      <div className="tp-info">
        <div className="tp-name">{activeTrack.name}</div>
        <div className="tp-sub">
          {activeProject ? activeProject.name : ''}{activeTrack.artist ? ' · ' + activeTrack.artist : ''}
        </div>
      </div>
      <div className="tp-controls">
        <button className="tp-btn" onClick={prev} aria-label="previous">⏮</button>
        <button className="tp-btn play" onClick={togglePlay} aria-label="play/pause">{playing ? '❚❚' : '▶'}</button>
        <button className="tp-btn" onClick={next} aria-label="next">⏭</button>
      </div>
      <div className="tp-seek">
        <span className="tp-time">{fmt(now.time)}</span>
        <div className="tp-bar" onClick={onScrub}>
          <div className="tp-fill" style={{ width: (frac * 100).toFixed(1) + '%' }} />
        </div>
        <span className="tp-time">{fmt(now.duration)}</span>
      </div>
      <button className="tp-close" onClick={stop} aria-label="stop">✕</button>
    </div>
  )
}

export function Overlay() {
  const { entered, enter, source, gyro, gyroSupported, toggleGyro, focused } = useAudio()

  if (!entered) {
    return (
      <div className="veil">
        <div className="veil-inner">
          <h1>CRATE<span>ROOM</span></h1>
          <p>an audio-reactive terminal</p>
          <button onClick={enter}>ENTER</button>
          <small>look around · click a computer to open it</small>
        </div>
      </div>
    )
  }

  return (
    <>
      {!focused && (
        <div className="hud top-left">
          <div className="tag">CRATE_ROOM</div>
          <div className="hint">
            {source === 'catalog' ? 'crate catalog' : 'demo synth'} · click a computer
          </div>
        </div>
      )}

      {gyroSupported && !focused && (
        <button
          className={'gyro-btn' + (gyro ? ' on' : '')}
          onClick={toggleGyro}
          aria-pressed={gyro}
        >
          {gyro ? '❚❚  gyro on · tap for swipe' : '◎  look with gyro'}
        </button>
      )}

      <Terminal />
      <Transport />
    </>
  )
}
