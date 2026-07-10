// The 12 CRT screens, in a stable order. `fallback` title + `seed` are used for
// the demo synth when the catalog has no track for a screen. `color` is the
// screen's permanent colour-bar hue (see palette.js) — used for its CRT canvas
// and, while it plays, the whole room's accent. Real tracks are mapped on at
// runtime from crate's /manifest.json (see audio/catalog.js).
import { TV_PALETTE } from '../palette'

const BASE = [
  { screen: 'Hero_s', fallback: 'MAINFRAME',     seed: 0 },
  { screen: 'L0_s',   fallback: 'NULL_POINTER',  seed: 2 },
  { screen: 'L1_s',   fallback: 'COLD_BOOT',     seed: 4 },
  { screen: 'Ls1_s',  fallback: 'DAEMON',        seed: 5 },
  { screen: 'L2_s',   fallback: 'SEGFAULT',      seed: 7 },
  { screen: 'Ls2_s',  fallback: 'KERNEL_PANIC',  seed: 9 },
  { screen: 'L3_s',   fallback: 'OVERFLOW',      seed: 3 },
  { screen: 'R0_s',   fallback: 'GHOST_SHELL',   seed: 6 },
  { screen: 'R1_s',   fallback: 'RED_QUEEN',     seed: 8 },
  { screen: 'P0_s',   fallback: 'DEADLOCK',      seed: 1 },
  { screen: 'P1_s',   fallback: 'TRACE_ROUTE',   seed: 10 },
  { screen: 'P2_s',   fallback: 'HARD_RESET',    seed: 11 },
]

export const SCREENS = BASE.map((s, i) => ({ ...s, color: TV_PALETTE[i % TV_PALETTE.length] }))

// Screen id -> its assigned colour-bar hex.
export const SCREEN_COLORS = Object.fromEntries(SCREENS.map((s) => [s.screen, s.color]))

// Any clicked mesh name -> its screen id. Covers the screen surface (_s), the
// CRT body (_b) and the text overlay plane (ScreenText_*).
export const NAME_TO_SCREEN = (() => {
  const m = {}
  for (const s of SCREENS) {
    const base = s.screen.replace(/_s$/, '')
    m[s.screen] = s.screen
    m[base + '_b'] = s.screen
    m['ScreenText_' + s.screen] = s.screen
  }
  return m
})()

export const SCREEN_SET = new Set(SCREENS.map((s) => s.screen))
