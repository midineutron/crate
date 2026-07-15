// Web Audio engine: one AnalyserNode fed ONLY by the built-in demo synth.
// Stream playback goes through a plain native <audio> element instead --
// iOS suspends Web-Audio-routed sources when the page is hidden/locked, but
// a native <audio> element keeps playing and gets Media Session lock-screen
// controls. To keep the SAME downstream consumers (freq/time/level/bass/
// treble) working for streams, the decoded file is analyzed once (off the
// main thread, in analyze.worker.js) into per-frame byte arrays that
// update() indexes by audioEl.currentTime.
export class AudioEngine {
  constructor() {
    this.ctx = null
    this.analyser = null
    this.freq = null
    this.time = null
    this.audioEl = null
    this.demoNodes = null
    this.master = null
    this.level = 0     // overall 0..1
    this.bass = 0      // low band 0..1
    this.treble = 0    // high band 0..1
    this.isStream = false // true while an <audio> stream is the source (vs demo)
    this.onEnded = null   // called when a stream track finishes (auto-advance)

    // Precomputed stream analysis (see analyze.worker.js). `frames` is
    // { fps, bins, fftSize, nFrames, freqAll, timeAll } -- flat, frame-major
    // Uint8Arrays -- or null until the worker finishes (or if analysis fails).
    this.frames = null
    this.analyzing = false // true while a stream's worker analysis is running
    this.worker = null
    this._analyzeGen = 0 // bumped on every stopSources()/new stream so stale
                          // fetch/decode/worker results are ignored
  }

  // Transport readouts for the control bar (seconds; 0 when unknown).
  get currentTime() { return this.audioEl ? this.audioEl.currentTime : 0 }
  get duration() {
    const d = this.audioEl && this.audioEl.duration
    return isFinite(d) ? d : 0
  }
  get paused() { return this.audioEl ? this.audioEl.paused : true }

  seek(sec) {
    if (this.audioEl && isFinite(sec)) {
      this.audioEl.currentTime = Math.max(0, Math.min(sec, this.duration || sec))
    }
  }

  pause() { if (this.audioEl) { try { this.audioEl.pause() } catch (e) {} } }
  async play() {
    if (!this.audioEl) return
    // The native element owns the iOS audio session (and thus Now Playing);
    // keep the Web Audio context suspended so it doesn't steal it back.
    if (this.ctx && this.ctx.state === 'running') { try { await this.ctx.suspend() } catch (e) {} }
    try { await this.audioEl.play() } catch (e) {}
  }

  _ensure() {
    if (this.ctx) return
    const Ctx = window.AudioContext || window.webkitAudioContext
    this.ctx = new Ctx()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.analyser.smoothingTimeConstant = 0.82
    this.freq = new Uint8Array(this.analyser.frequencyBinCount)
    this.time = new Uint8Array(this.analyser.fftSize)
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.85
    this.master.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)
  }

  async resume() {
    this._ensure()
    if (this.ctx.state === 'suspended') await this.ctx.resume()
  }

  _ensureWorker() {
    if (this.worker) return this.worker
    this.worker = new Worker(new URL('./analyze.worker.js', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e) => {
      const d = e.data
      if (!d || d.gen !== this._analyzeGen) return // stale: track changed since this job started
      if (d.ok) {
        this.frames = {
          fps: d.fps, bins: d.bins, fftSize: d.fftSize, nFrames: d.nFrames,
          freqAll: d.freqAll, timeAll: d.timeAll,
        }
      } else {
        console.error('stream analysis failed', d.error)
        this.frames = null
      }
      this.analyzing = false
    }
    this.worker.onerror = (err) => {
      console.error('analyze worker crashed', err)
      this.analyzing = false
    }
    return this.worker
  }

  // Decode compressed audio into PCM without ever resuming the throwaway
  // context, so this never produces audible output or fights iOS's one
  // "real" playing context.
  async _decodeForAnalysis(arrayBuffer) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    const tmp = new Ctx()
    try {
      return await tmp.decodeAudioData(arrayBuffer)
    } finally {
      try { await tmp.close() } catch (e) {}
    }
  }

  // Load a PRECOMPUTED spectrum sidecar (tools/precompute_fft.py) instead of
  // re-downloading + decoding the whole track. Decoding a lossless track was a
  // >100 MB memory spike at every transition that stalled background/lock-screen
  // playback; the sidecar is a few MB and needs no decode. Falls back to
  // on-the-fly analysis when the sidecar is missing (untagged/new tracks).
  async _loadFrames(fftUrl, streamUrl, gen) {
    this.analyzing = true
    try {
      const res = await fetch(fftUrl, { credentials: 'same-origin' })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const buf = await res.arrayBuffer()
      if (gen !== this._analyzeGen) return
      const dv = new DataView(buf)
      // Header: "CFFT" u8 version u8 fps u16 fftSize u16 bins u32 nFrames.
      if (dv.getUint8(0) !== 0x43 || dv.getUint8(1) !== 0x46 ||
          dv.getUint8(2) !== 0x46 || dv.getUint8(3) !== 0x54) throw new Error('bad magic')
      const fps = dv.getUint8(5)
      const fftSize = dv.getUint16(6, true)
      const bins = dv.getUint16(8, true)
      const nFrames = dv.getUint32(10, true)
      let off = 14
      const freqLen = nFrames * bins
      const timeLen = nFrames * fftSize
      if (off + freqLen + timeLen > buf.byteLength) throw new Error('truncated sidecar')
      const freqAll = new Uint8Array(buf, off, freqLen)
      const timeAll = new Uint8Array(buf, off + freqLen, timeLen)
      if (gen !== this._analyzeGen) return
      this.frames = { fps, bins, fftSize, nFrames, freqAll, timeAll }
      this.analyzing = false
    } catch (e) {
      if (gen !== this._analyzeGen) return
      console.warn('fft sidecar unavailable, analyzing stream:', String(e && e.message || e))
      this._analyzeStream(streamUrl, gen) // graceful fallback (fetch + decode)
    }
  }

  // Kick off (fetch -> decode -> worker FFT) for the current stream. Guarded
  // by `gen` throughout so a fast track skip discards stale work instead of
  // clobbering the frames for the track that's actually playing now.
  async _analyzeStream(url, gen) {
    this.analyzing = true
    try {
      const res = await fetch(url, { credentials: 'same-origin' })
      const arrayBuffer = await res.arrayBuffer()
      if (gen !== this._analyzeGen) return
      const audioBuffer = await this._decodeForAnalysis(arrayBuffer)
      if (gen !== this._analyzeGen) return

      // Mono mixdown -- the worker only needs one channel to build a spectrum.
      const chans = audioBuffer.numberOfChannels
      const len = audioBuffer.length
      const mono = new Float32Array(len)
      for (let c = 0; c < chans; c++) {
        const data = audioBuffer.getChannelData(c)
        for (let i = 0; i < len; i++) mono[i] += data[i] / chans
      }
      if (gen !== this._analyzeGen) return

      const bins = this.analyser.frequencyBinCount
      const fftSize = this.analyser.fftSize
      const worker = this._ensureWorker()
      worker.postMessage(
        { gen, channelData: mono, sampleRate: audioBuffer.sampleRate, fps: 24, fftSize, bins },
        [mono.buffer]
      )
    } catch (e) {
      console.error('stream analysis setup failed', e)
      if (gen === this._analyzeGen) { this.analyzing = false; this.frames = null }
    }
  }

  stopSources() {
    if (this.demoNodes) {
      for (const n of this.demoNodes) {
        try { n.stop && n.stop() } catch (e) {}
        try { n.disconnect && n.disconnect() } catch (e) {}
      }
      this.demoNodes = null
    }
    if (this.audioEl) { try { this.audioEl.pause() } catch (e) {} }
    // Invalidate any in-flight stream analysis (fetch/decode/worker) so a
    // fast skip or switch to the demo synth can't land stale frames.
    this._analyzeGen++
    this.frames = null
    this.analyzing = false
  }

  async playStream(url, fftUrl = null) {
    this.stopSources()
    // Streams play ONLY through the native <audio> element. A running
    // AudioContext connected to `destination` would own the iOS audio session
    // and suppress the element's lock-screen Now Playing metadata, so suspend
    // ours while a stream plays. (Decode uses a separate throwaway context, and
    // stream visuals read precomputed frames -- neither needs `this.ctx` live.)
    if (this.ctx && this.ctx.state === 'running') { try { await this.ctx.suspend() } catch (e) {} }
    // Same-origin media (crate's /audio/...) must NOT set crossOrigin, so the
    // auth cookie is sent. Only set crossOrigin for a genuinely cross-origin
    // stream. (No longer analyser-related -- kept for correct fetch/credential
    // behaviour of the <audio> element itself.)
    const sameOrigin =
      url.startsWith('/') || (typeof location !== 'undefined' && url.startsWith(location.origin))
    if (!this.audioEl) {
      this.audioEl = new Audio()
      this.audioEl.playsInline = true
      this.audioEl.preload = 'auto'
      if (!sameOrigin) this.audioEl.crossOrigin = 'anonymous'
      this.audioEl.loop = false // playlists advance instead of looping one track
      // iOS only surfaces a Media Session "Now Playing" card for a media element
      // that is connected to the document -- a detached `new Audio()` plays but
      // stays invisible to the lock screen. Attach it hidden.
      this.audioEl.setAttribute('aria-hidden', 'true')
      this.audioEl.style.display = 'none'
      if (typeof document !== 'undefined' && document.body) {
        document.body.appendChild(this.audioEl)
      }
      this.audioEl.addEventListener('ended', () => {
        if (this.isStream && typeof this.onEnded === 'function') this.onEnded()
      })
    }
    // Play natively (default output) -- NOT routed through Web Audio, so
    // iOS keeps it alive in the background / with the screen locked.
    this.isStream = true
    this.audioEl.src = url
    // iOS occasionally rejects the first play() on a background src-swap (lock-
    // screen skip / auto-advance). Retry once, and never throw -- the caller
    // should still advance transport state so the next track isn't stranded.
    try {
      await this.audioEl.play()
    } catch (e) {
      try { await this.audioEl.play() } catch (e2) { console.error('stream play failed', e2) }
    }

    // Drive visuals from the precomputed sidecar when available (no decode);
    // otherwise analyze the stream on the fly. update() shows zeros until frames
    // arrive. Guarded by `gen` so a fast skip discards stale work.
    const gen = ++this._analyzeGen
    if (fftUrl) this._loadFrames(fftUrl, url, gen)
    else this._analyzeStream(url, gen)
  }

  // Evolving pad + sub + hats, tuned by `seed`, routed into the analyser.
  async playDemo(seed = 0) {
    await this.resume()
    this.stopSources()
    this.isStream = false
    const ctx = this.ctx
    const t = ctx.currentTime
    const nodes = []
    const base = 55 * Math.pow(2, (seed % 12) / 12) // per-project pitch

    // --- sub bass with tremolo (drives the "bass" band + room pulse) ---
    const sub = ctx.createOscillator(); sub.type = 'sine'; sub.frequency.value = base
    const subGain = ctx.createGain(); subGain.gain.value = 0.0
    const trem = ctx.createOscillator(); trem.type = 'sine'; trem.frequency.value = 1.6 + (seed % 4) * 0.35
    const tremGain = ctx.createGain(); tremGain.gain.value = 0.5
    trem.connect(tremGain); tremGain.connect(subGain.gain)
    subGain.gain.value = 0.5
    sub.connect(subGain); subGain.connect(this.master)

    // --- detuned saw pad through a moving lowpass ---
    const oscA = ctx.createOscillator(); oscA.type = 'sawtooth'; oscA.frequency.value = base * 4
    const oscB = ctx.createOscillator(); oscB.type = 'sawtooth'; oscB.frequency.value = base * 4 * 1.006
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 6
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.12 + (seed % 5) * 0.05
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 900
    lfo.connect(lfoGain); lfoGain.connect(lp.frequency)
    const padGain = ctx.createGain(); padGain.gain.value = 0.12
    oscA.connect(lp); oscB.connect(lp); lp.connect(padGain); padGain.connect(this.master)

    // --- filtered noise "hats" pulsing (drives treble band) ---
    const bufLen = ctx.sampleRate * 2
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000
    const hatGain = ctx.createGain(); hatGain.gain.value = 0.0
    const hatLfo = ctx.createOscillator(); hatLfo.type = 'square'; hatLfo.frequency.value = 4 + (seed % 3)
    const hatLfoGain = ctx.createGain(); hatLfoGain.gain.value = 0.06
    hatLfo.connect(hatLfoGain); hatLfoGain.connect(hatGain.gain)
    hatGain.gain.value = 0.05
    noise.connect(hp); hp.connect(hatGain); hatGain.connect(this.master)

    for (const o of [sub, trem, oscA, oscB, lfo, hatLfo]) o.start(t)
    noise.start(t)
    nodes.push(sub, trem, oscA, oscB, lfo, hatLfo, noise,
               subGain, tremGain, padGain, lp, lfoGain, hp, hatGain, hatLfoGain)
    this.demoNodes = nodes
  }

  update() {
    if (!this.analyser) return

    if (this.isStream) {
      const f = this.frames
      if (f && !document.hidden) {
        let idx = Math.floor((this.audioEl ? this.audioEl.currentTime : 0) * f.fps)
        if (idx < 0) idx = 0
        else if (idx >= f.nFrames) idx = f.nFrames - 1
        const fOff = idx * f.bins
        for (let i = 0; i < f.bins; i++) this.freq[i] = f.freqAll[fOff + i]
        const tOff = idx * f.fftSize
        for (let i = 0; i < f.fftSize; i++) this.time[i] = f.timeAll[tOff + i]
      } else {
        // Not analyzed yet (or tab hidden): keep visuals idle rather than stale.
        this.freq.fill(0)
        this.time.fill(0)
      }
    } else {
      // Demo synth: live analyser path, unchanged.
      this.analyser.getByteFrequencyData(this.freq)
      this.analyser.getByteTimeDomainData(this.time)
    }

    const N = this.freq.length
    let sum = 0
    for (let i = 0; i < N; i++) sum += this.freq[i]
    this.level = sum / N / 255
    const bN = Math.max(1, Math.floor(N * 0.08))
    let b = 0
    for (let i = 0; i < bN; i++) b += this.freq[i]
    this.bass = b / bN / 255
    let tr = 0, tN = 0
    for (let i = Math.floor(N * 0.6); i < N; i++) { tr += this.freq[i]; tN++ }
    this.treble = tN ? tr / tN / 255 : 0
  }
}
