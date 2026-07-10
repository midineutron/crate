// Per-CRT canvas renderer. Two modes:
//   drawIdle  — generative boot-log/terminal that makes every idle computer feel
//               alive and distinct (seeded per project).
//   drawViz   — the audio-reactive visualizer (equalizer + oscilloscope) for the
//               screen whose project is currently playing.
const RED = '#ff261e'
const DIM = '#7a1310'
const MID = '#b5322a'

export function makeScreenCanvas() {
  const c = document.createElement('canvas')
  c.width = 320
  c.height = 240
  return c
}

// Cheap deterministic PRNG so idle content is stable per seed.
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

const GLYPHS = '0123456789ABCDEF::..//<>[]{}=+*#'
function codeLine(rand, n) {
  let out = ''
  for (let i = 0; i < n; i++) out += GLYPHS[(rand() * GLYPHS.length) | 0]
  return out
}

function scanlines(ctx, W, H) {
  ctx.fillStyle = 'rgba(0,0,0,0.32)'
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1)
}
function flicker(ctx, W, H, tSec) {
  const fl = ((tSec * 90) % H) | 0
  ctx.fillStyle = 'rgba(255,60,50,0.05)'
  ctx.fillRect(0, fl, W, 6)
}

// Generative idle terminal. `project` may be null (dark/offline CRT).
export function drawIdle(canvas, project, tSec, level) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  ctx.fillStyle = '#070101'
  ctx.fillRect(0, 0, W, H)

  if (!project) {
    // Offline: rolling static + NO SIGNAL.
    ctx.fillStyle = DIM
    ctx.font = 'bold 18px Menlo, monospace'
    ctx.fillText('NO SIGNAL', 14, 34)
    const rand = rng((tSec * 20) | 0)
    ctx.fillStyle = 'rgba(180,50,42,0.5)'
    for (let i = 0; i < 60; i++) {
      ctx.fillRect((rand() * W) | 0, (rand() * H) | 0, 2, 2)
    }
    scanlines(ctx, W, H)
    flicker(ctx, W, H, tSec)
    return
  }

  const seed = (project.seed || 0) + project.name.length
  // Header
  ctx.fillStyle = RED
  ctx.font = 'bold 17px Menlo, monospace'
  ctx.fillText(project.name.slice(0, 22), 12, 26)
  ctx.fillStyle = DIM
  ctx.font = '10px Menlo, monospace'
  ctx.fillText('CRATE OS  ::  ' + (project.kind === 'album' ? 'ALBUM' : 'MIX'), 12, 42)
  ctx.fillText(project.tracks.length + ' TRACKS', W - 78, 42)
  ctx.strokeStyle = DIM
  ctx.beginPath(); ctx.moveTo(12, 50); ctx.lineTo(W - 12, 50); ctx.stroke()

  // Scrolling generative boot log
  ctx.font = '11px Menlo, monospace'
  const rowH = 15
  const rows = 9
  const scroll = (tSec * 12) % rowH
  for (let r = 0; r < rows; r++) {
    const line = Math.floor(tSec * 0.8) + r
    const rand = rng(seed * 131 + line)
    const y = 68 + r * rowH - scroll
    const fade = 0.25 + 0.6 * (r / rows)
    ctx.fillStyle = `rgba(200,52,42,${fade.toFixed(2)})`
    const tag = ['LOAD', 'SYNC', 'READ', 'DECODE', 'CACHE', 'STREAM'][(rand() * 6) | 0]
    ctx.fillText('> ' + tag + ' ' + codeLine(rand, 10 + ((rand() * 8) | 0)), 12, y)
  }

  // Idle equalizer strip along the bottom, breathing with room ambience.
  const bars = 32
  const bw = W / bars
  const rand = rng(seed)
  for (let b = 0; b < bars; b++) {
    const base = 0.15 + 0.85 * rand()
    const v = base * (0.3 + level * 0.7) * (0.6 + 0.4 * Math.sin(tSec * 2 + b * 0.5))
    const bh = Math.max(2, v * 30)
    ctx.fillStyle = MID
    ctx.fillRect(b * bw + 1, H - bh, bw - 2, bh)
  }

  // Blinking cursor
  if (((tSec * 2) | 0) % 2 === 0) {
    ctx.fillStyle = RED
    ctx.fillRect(12, H - 44, 8, 12)
  }

  scanlines(ctx, W, H)
  flicker(ctx, W, H, tSec)
}

// Active audio visualizer. `info` = { name, sub }.
export function drawViz(canvas, freq, time, info, tSec) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  ctx.fillStyle = '#080101'
  ctx.fillRect(0, 0, W, H)

  // header
  ctx.fillStyle = RED
  ctx.font = 'bold 16px Menlo, monospace'
  ctx.fillText('> ' + (info ? info.name : '').slice(0, 24), 10, 24)
  ctx.fillStyle = DIM
  ctx.font = '10px Menlo, monospace'
  ctx.fillText('NOW PLAYING' + (info && info.sub ? '  ::  ' + info.sub : ''), 10, 40)

  // waveform (oscilloscope)
  const midY = 108
  ctx.strokeStyle = RED
  ctx.lineWidth = 1.6
  ctx.beginPath()
  const step = Math.max(1, Math.floor(time.length / W))
  for (let x = 0, i = 0; x < W; x++, i += step) {
    const v = (time[i] - 128) / 128
    const y = midY + v * 42
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // equalizer bars
  const bars = 36
  const bw = W / bars
  const binPer = Math.floor((freq.length * 0.7) / bars)
  for (let b = 0; b < bars; b++) {
    let sum = 0
    for (let k = 0; k < binPer; k++) sum += freq[b * binPer + k]
    const v = sum / binPer / 255
    const bh = Math.max(2, v * 92)
    const grad = ctx.createLinearGradient(0, H, 0, H - 92)
    grad.addColorStop(0, DIM)
    grad.addColorStop(1, RED)
    ctx.fillStyle = grad
    ctx.fillRect(b * bw + 1, H - bh, bw - 2, bh)
  }

  scanlines(ctx, W, H)
  flicker(ctx, W, H, tSec)
}
