import { useState } from 'react'
import { useAudio } from '../audio/audioContext'
import { offlineSupported } from '../audio/offlineStore'
import { shades, RED } from '../palette'
import { DebugHud } from './DebugHud'

// Human-readable byte size for the SAVED readout.
function fmtBytes(n) {
  if (!n) return ''
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'GB'
  if (n >= 1e6) return Math.round(n / 1e6) + 'MB'
  return Math.max(1, Math.round(n / 1e3)) + 'KB'
}

function fmt(sec) {
  if (!sec || !isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return m + ':' + String(s).padStart(2, '0')
}

// The terminal that appears over the focused CRT: project header + track list.
function Terminal() {
  const {
    focusedProject, focused, active, playing, playTrack, back,
    savedOffline, saveProgress, saveOffline, removeOffline,
  } = useAudio()
  if (!focusedProject) return null
  const proj = focusedProject
  // Scope the terminal to the focused TV's own colour, independent of the room
  // accent (which tracks whatever is currently playing).
  const p = shades(proj.color || RED)
  const style = { '--accent': p.main, '--accent-mid': p.mid, '--accent-dim': p.dim, '--accent-rgb': p.rgb }
  // Offline-save state for this screen: only streamable (non-demo) projects, and
  // only where the Cache API exists.
  const savedEntry = savedOffline && savedOffline[proj.screen]
  const canSave = offlineSupported() && proj.tracks.some((t) => t.streamId)
  const prog = saveProgress && saveProgress.screen === proj.screen ? saveProgress : null
  const offlineBtn = !canSave ? null : (
    prog ? (
      <button
        className="term-save saving"
        disabled
        aria-label={'Saving for offline (' + prog.done + '/' + prog.total + ')'}
        title={'Saving for offline… ' + prog.done + '/' + prog.total}
      >◐</button>
    ) : savedEntry && savedEntry.partial ? (
      <button
        className="term-save partial"
        onClick={() => saveOffline(proj.screen)}
        aria-label={'Partly available offline (' + savedEntry.trackCount + '/' + savedEntry.expected + '), tap to finish'}
        title={'Partly saved (' + savedEntry.trackCount + '/' + savedEntry.expected + ') · tap to finish'}
      >◑</button>
    ) : savedEntry ? (
      <button
        className="term-save saved"
        onClick={() => removeOffline(proj.screen)}
        aria-label="Available offline, tap to remove"
        title={'Available offline' + (savedEntry.bytes ? ' · ' + fmtBytes(savedEntry.bytes) : '') + ' · tap to remove'}
      >◉</button>
    ) : (
      <button
        className="term-save"
        onClick={() => saveOffline(proj.screen)}
        aria-label="Make available offline"
        title="Make this project available offline"
      >◎</button>
    )
  )
  return (
    <div className={'terminal' + (active ? ' with-transport' : '')} style={style}>
      <div className="term-scan" />
      <div className="term-head">
        <span className="term-os">CRATE OS</span>
        <span className="term-kind">{proj.kind === 'album' ? 'ALBUM' : 'MIX'}</span>
      </div>
      <div className="term-title-row">
        <div className="term-title">{proj.name}</div>
        {offlineBtn}
      </div>
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
        <button className="tp-btn" onClick={prev} aria-label="previous">◀◀</button>
        <button className="tp-btn play" onClick={togglePlay} aria-label="play/pause">{playing ? '❚❚' : '▶'}</button>
        <button className="tp-btn" onClick={next} aria-label="next">▶▶</button>
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

// Settings modal (audio quality). Opened from the gear by the gyro control.
function Settings({ open, onClose }) {
  const { quality, setQuality, gyro, gyroSupported, toggleGyro } = useAudio()
  if (!open) return null
  return (
    <div className="settings-veil" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span className="term-os">CRATE OS</span>
          <span className="settings-title">SETTINGS</span>
        </div>
        <div className="settings-row">
          <div className="settings-label">
            AUDIO
            <small>lossless keeps full quality · lossy uses less data</small>
          </div>
          <div className="settings-seg" role="group" aria-label="Audio quality">
            <button
              className={quality === 'lossless' ? 'on' : ''}
              aria-pressed={quality === 'lossless'}
              onClick={() => setQuality('lossless')}
            >LOSSLESS</button>
            <button
              className={quality === 'lossy' ? 'on' : ''}
              aria-pressed={quality === 'lossy'}
              onClick={() => setQuality('lossy')}
            >LOSSY</button>
          </div>
        </div>
        {gyroSupported && (
          <div className="settings-row">
            <div className="settings-label">
              LOOK
              <small>tilt your phone to look around the room</small>
            </div>
            <div className="settings-seg" role="group" aria-label="Gyro look">
              <button
                className={!gyro ? 'on' : ''}
                aria-pressed={!gyro}
                onClick={() => { if (gyro) toggleGyro() }}
              >SWIPE</button>
              <button
                className={gyro ? 'on' : ''}
                aria-pressed={gyro}
                onClick={() => { if (!gyro) toggleGyro() }}
              >GYRO</button>
            </div>
          </div>
        )}
        <button className="settings-close" onClick={onClose}>CLOSE</button>
      </div>
    </div>
  )
}

export function Overlay() {
  const { entered, enter, source, focused } = useAudio()
  const [settingsOpen, setSettingsOpen] = useState(false)

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

      {!focused && (
        <button
          className="settings-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label="Settings"
        >⚙</button>
      )}

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Terminal />
      <Transport />
      <DebugHud />
    </>
  )
}
