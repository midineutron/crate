// Minimal dependency-free radix-2 Cooley-Tukey FFT, in-place, power-of-two only.
// Used by analyze.worker.js to precompute a spectrum from decoded PCM so
// stream playback (native <audio>, no Web Audio routing) can still drive the
// visuals by indexing precomputed frames with audioEl.currentTime.

// Hann window applied in place to a Float32Array slice (length must match
// the FFT size used downstream).
export function hannWindow(frame) {
  const n = frame.length
  if (n <= 1) return frame
  const denom = n - 1
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / denom)
    frame[i] *= w
  }
  return frame
}

// In-place radix-2 iterative Cooley-Tukey FFT. `re`/`im` are Float32Arrays
// of equal length N (power of two). Result overwrites re/im with the
// transform (not normalized).
export function fft(re, im) {
  const n = re.length
  if (n <= 1) return

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp
      tmp = im[i]; im[i] = im[j]; im[j] = tmp
    }
  }

  // Iterative Cooley-Tukey butterflies.
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < half; k++) {
        const uRe = re[i + k]
        const uIm = im[i + k]
        const vRe = re[i + k + half] * curRe - im[i + k + half] * curIm
        const vIm = re[i + k + half] * curIm + im[i + k + half] * curRe
        re[i + k] = uRe + vRe
        im[i + k] = uIm + vIm
        re[i + k + half] = uRe - vRe
        im[i + k + half] = uIm - vIm
        const nextRe = curRe * wRe - curIm * wIm
        const nextIm = curRe * wIm + curIm * wRe
        curRe = nextRe
        curIm = nextIm
      }
    }
  }
}

// Real-input FFT magnitude spectrum. `real` is a Float32Array of length N
// (power of two). Returns a Float32Array of length N/2 with linear
// magnitudes (not normalized/dB -- caller maps to dB/bytes).
export function magnitudeSpectrum(real) {
  const n = real.length
  const re = Float32Array.from(real)
  const im = new Float32Array(n)
  fft(re, im)
  const half = n >> 1
  const mag = new Float32Array(half)
  for (let i = 0; i < half; i++) {
    mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i])
  }
  return mag
}

// Smallest power of two >= n.
export function nextPow2(n) {
  let p = 1
  while (p < n) p <<= 1
  return p
}
