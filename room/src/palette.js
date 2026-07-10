// SMPTE / EBU television colour-bar palette. Each CRT is permanently assigned
// one of these; the room's default (nothing playing) accent is red.
export const RED = '#ff2a1e'

// The seven canonical bars (red, yellow, cyan, green, magenta, blue, white)
// plus five test-signal-flavoured extras to give all 12 CRTs a distinct hue.
// Kept vivid so they glow well through the bloom pass.
export const TV_PALETTE = [
  '#ff2a1e', // red      (hero)
  '#ffd21e', // yellow
  '#1ee5e5', // cyan
  '#2fe04a', // green
  '#ff36c2', // magenta
  '#4a82ff', // blue
  '#e6e6e6', // white
  '#ff8a1e', // orange
  '#1ec99a', // teal
  '#9d5cff', // violet
  '#ffb01e', // amber
  '#ff5478', // rose
]

export function hexToRgb(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex(rgb) {
  return '#' + rgb
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('')
}

// Derive the mid / dim shades and an "r,g,b" string used for rgba() in CSS.
export function shades(hex) {
  const rgb = hexToRgb(hex)
  return {
    main: hex,
    mid: toHex(rgb.map((v) => v * 0.7)),
    dim: toHex(rgb.map((v) => v * 0.42)),
    rgb: rgb.join(','),
  }
}
