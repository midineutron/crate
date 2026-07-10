import { useAudio } from '../audio/audioContext'

export function Overlay() {
  const { active, entered, enter, stop, source, gyro, gyroSupported, toggleGyro } = useAudio()

  if (!entered) {
    return (
      <div className="veil">
        <div className="veil-inner">
          <h1>CRATE<span>ROOM</span></h1>
          <p>an audio-reactive terminal</p>
          <button onClick={enter}>ENTER</button>
          <small>look around · tap a screen to play</small>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="hud top-left">
        <div className="tag">CRATE_ROOM</div>
        <div className="hint">
          {source === 'catalog' ? 'crate catalog' : 'demo synth'} · tap a screen
        </div>
      </div>

      {gyroSupported && (
        <button
          className={'gyro-btn' + (gyro ? ' on' : '')}
          onClick={toggleGyro}
          aria-pressed={gyro}
        >
          {gyro ? '❚❚  gyro on · tap for swipe' : '◎  look with gyro'}
        </button>
      )}

      {active && (
        <div className="hud bottom">
          <div className="np"><span className="dot" /> NOW PLAYING</div>
          <div className="title">{active.title}</div>
          <div className="sub">
            {active.streamUrl ? 'stream' : 'demo synth'}{active.artist ? ' · ' + active.artist : ''}
          </div>
          <button className="stop" onClick={stop}>STOP</button>
        </div>
      )}
    </>
  )
}
