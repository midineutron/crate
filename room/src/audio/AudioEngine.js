// Web Audio engine: one AnalyserNode fed by either an <audio> stream or a
// built-in demo synth. Per-frame data is read directly (no React re-render).
export class AudioEngine {
  constructor() {
    this.ctx = null
    this.analyser = null
    this.freq = null
    this.time = null
    this.audioEl = null
    this.mediaSource = null
    this.demoNodes = null
    this.master = null
    this.level = 0     // overall 0..1
    this.bass = 0      // low band 0..1
    this.treble = 0    // high band 0..1
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

  stopSources() {
    if (this.demoNodes) {
      for (const n of this.demoNodes) {
        try { n.stop && n.stop() } catch (e) {}
        try { n.disconnect && n.disconnect() } catch (e) {}
      }
      this.demoNodes = null
    }
    if (this.audioEl) { try { this.audioEl.pause() } catch (e) {} }
  }

  async playStream(url) {
    await this.resume()
    this.stopSources()
    // Same-origin media (crate's /audio/...) must NOT set crossOrigin, so the
    // auth cookie is sent and the analyser can read it untainted. Only set
    // crossOrigin for a genuinely cross-origin stream.
    const sameOrigin =
      url.startsWith('/') || (typeof location !== 'undefined' && url.startsWith(location.origin))
    if (!this.audioEl) {
      this.audioEl = new Audio()
      if (!sameOrigin) this.audioEl.crossOrigin = 'anonymous'
      this.audioEl.loop = true
      this.mediaSource = this.ctx.createMediaElementSource(this.audioEl)
      this.mediaSource.connect(this.master)
    }
    this.audioEl.src = url
    await this.audioEl.play()
  }

  // Evolving pad + sub + hats, tuned by `seed`, routed into the analyser.
  async playDemo(seed = 0) {
    await this.resume()
    this.stopSources()
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
    this.analyser.getByteFrequencyData(this.freq)
    this.analyser.getByteTimeDomainData(this.time)
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
