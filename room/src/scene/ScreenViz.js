// Draws the audio-reactive CRT visualizer (equalizer + waveform + header)
// onto a 2D canvas. Called every frame for the active screen only.
const RED = '#ff261e'
const DIM = '#7a1310'

export function makeScreenCanvas() {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 170
  return c
}

export function drawViz(canvas, freq, time, project, tSec) {
  const ctx = canvas.getContext('2d')
  const W = canvas.width, H = canvas.height
  // background
  ctx.fillStyle = '#080101'
  ctx.fillRect(0, 0, W, H)

  // header
  ctx.fillStyle = RED
  ctx.font = 'bold 15px Menlo, monospace'
  ctx.fillText('> ' + (project ? project.title : '') , 8, 20)
  ctx.fillStyle = DIM
  ctx.font = '11px Menlo, monospace'
  ctx.fillText('NOW PLAYING' + (project && project.artist ? '  ::  ' + project.artist : ''), 8, 36)

  // waveform (oscilloscope) across the middle
  const midY = 78
  ctx.strokeStyle = RED
  ctx.lineWidth = 1.5
  ctx.beginPath()
  const step = Math.max(1, Math.floor(time.length / W))
  for (let x = 0, i = 0; x < W; x++, i += step) {
    const v = (time[i] - 128) / 128
    const y = midY + v * 30
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // equalizer bars along the bottom
  const bars = 28
  const bw = W / bars
  const binPer = Math.floor((freq.length * 0.7) / bars)
  for (let b = 0; b < bars; b++) {
    let sum = 0
    for (let k = 0; k < binPer; k++) sum += freq[b * binPer + k]
    const v = sum / binPer / 255
    const bh = Math.max(2, v * 66)
    const grad = ctx.createLinearGradient(0, H, 0, H - 66)
    grad.addColorStop(0, DIM)
    grad.addColorStop(1, RED)
    ctx.fillStyle = grad
    ctx.fillRect(b * bw + 1, H - bh, bw - 2, bh)
  }

  // scanlines
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1)

  // flicker line
  const fl = ((tSec * 90) % H) | 0
  ctx.fillStyle = 'rgba(255,60,50,0.06)'
  ctx.fillRect(0, fl, W, 6)
}
