// Web Worker: precomputes a spectrum + waveform timeline from decoded PCM so
// stream playback can drive the visuals without routing audio through Web
// Audio (which iOS suspends when the page is backgrounded/locked).
//
// Message in:  { gen, channelData: Float32Array (transferred), sampleRate,
//                fps, fftSize, bins }
// Message out: { gen, ok, fps, bins, fftSize, nFrames,
//                freqAll: Uint8Array (transferred, nFrames*bins),
//                timeAll: Uint8Array (transferred, nFrames*fftSize) }
// freqAll/timeAll are flat, frame-major buffers; frame i's freq bytes live
// at freqAll[i*bins .. i*bins+bins) and its time bytes at
// timeAll[i*fftSize .. i*fftSize+fftSize), mirroring
// AnalyserNode#getByteFrequencyData / #getByteTimeDomainData.
import { hannWindow, magnitudeSpectrum } from './fft.js'

// Matches the default AnalyserNode decibel range used to map magnitude -> byte.
const MIN_DB = -100
const MAX_DB = -30
const DB_RANGE = MAX_DB - MIN_DB
const SMOOTHING = 0.82 // matches AudioEngine's analyser.smoothingTimeConstant

function analyze(channelData, sampleRate, fps, fftSize, bins) {
  const total = channelData.length
  const duration = total / sampleRate
  const nFrames = Math.max(1, Math.ceil(duration * fps))
  const hop = sampleRate / fps

  const freqAll = new Uint8Array(nFrames * bins)
  const timeAll = new Uint8Array(nFrames * fftSize)

  const raw = new Float32Array(fftSize)
  const windowed = new Float32Array(fftSize)
  const prevFreq = new Float32Array(bins) // running smoothed value per bin (float, 0..255 scale)

  for (let f = 0; f < nFrames; f++) {
    const start = Math.round(f * hop)
    for (let k = 0; k < fftSize; k++) {
      const si = start + k
      raw[k] = si >= 0 && si < total ? channelData[si] : 0
    }

    // Time-domain byte frame: raw samples, no windowing/smoothing, mirrors
    // getByteTimeDomainData's [-1,1] -> [0,255] centered-at-128 mapping.
    const tOff = f * fftSize
    for (let k = 0; k < fftSize; k++) {
      let b = Math.round(128 + raw[k] * 128)
      if (b < 0) b = 0
      else if (b > 255) b = 255
      timeAll[tOff + k] = b
    }

    // Frequency-domain byte frame: Hann-windowed FFT magnitude -> dB ->
    // byte range, temporally smoothed like AnalyserNode#smoothingTimeConstant.
    windowed.set(raw)
    hannWindow(windowed)
    const mag = magnitudeSpectrum(windowed) // length fftSize/2
    const fOff = f * bins
    for (let i = 0; i < bins; i++) {
      const m = i < mag.length ? mag[i] : 0
      const db = 20 * Math.log10(m + 1e-6)
      let byte = ((db - MIN_DB) / DB_RANGE) * 255
      if (byte < 0) byte = 0
      else if (byte > 255) byte = 255
      const smoothed = SMOOTHING * prevFreq[i] + (1 - SMOOTHING) * byte
      prevFreq[i] = smoothed
      freqAll[fOff + i] = smoothed | 0
    }
  }

  return { nFrames, freqAll, timeAll }
}

self.onmessage = (e) => {
  const { gen, channelData, sampleRate, fps, fftSize, bins } = e.data || {}
  try {
    const { nFrames, freqAll, timeAll } = analyze(channelData, sampleRate, fps, fftSize, bins)
    self.postMessage(
      { gen, ok: true, fps, bins, fftSize, nFrames, freqAll, timeAll },
      [freqAll.buffer, timeAll.buffer]
    )
  } catch (err) {
    self.postMessage({ gen, ok: false, error: String((err && err.message) || err) })
  }
}
