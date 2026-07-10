# CRATE_ROOM — audio-reactive 3D website

A React Three Fiber site rendering a stylized computer room (built in
Blender, exported to glTF). Each CRT screen is a clickable "project" that plays
an audio stream and turns that screen into a live audio-reactive visualizer
(equalizer + oscilloscope), while the whole room pulses (emissive glow, red
lights, bloom) to the music.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build -> dist/
npm run preview    # serve the production build
```

Controls: **drag to look around**, **click a CRT** to play its project, **STOP**
to end. Click **ENTER** first (browsers require a user gesture before audio).

## Wiring your streaming backend

Audio comes from `src/config/projects.js`. Each entry maps one CRT screen (by its
GLB mesh name, e.g. `L0_s`) to a project. Two ways to point at your backend:

1. Set an env var and give each project an `id`:
   ```bash
   VITE_STREAM_BASE=https://api.you.dev/stream npm run dev
   ```
   The app requests `${VITE_STREAM_BASE}/${project.id}` per screen.
2. Or set an explicit `streamUrl` on each project.

If `streamUrl` resolves to null, the screen falls back to a **built-in demo
synth** so reactivity is visible with no backend.

### CORS (required)
For the Web Audio `AnalyserNode` to read your stream, the stream response MUST
send `Access-Control-Allow-Origin`. The `<audio>` element is created with
`crossOrigin="anonymous"`. Without CORS the browser taints the audio and the
visualizer/reactivity goes silent (audio may still play, but data reads as zero).

## How reactivity works

- `src/audio/AudioEngine.js` — one `AnalyserNode` fed by the `<audio>` stream (or
  the demo synth). Exposes `level`, `bass`, `treble`, and raw `freq`/`time`
  arrays, read every frame (no React re-renders).
- `src/scene/Room.jsx` — clones each screen material so screens glow
  independently; the active screen swaps its emissive texture for a live
  `CanvasTexture` drawn by `ScreenViz.js`; idle screens keep the baked terminal
  text and pulse subtly.
- `src/App.jsx` — red cluster lights and post-processing **Bloom** intensity are
  driven by the audio level/bass each frame. Tone mapping is AgX to match the
  Blender look; `THREE.FogExp2` adds the hazy depth.

## Source scene

The Blender file is in `blender/crate_room.blend`. Re-export with the glTF
exporter (GLB, +Y up, apply modifiers, no cameras/lights) to
`public/crate_room.glb`. Screen surfaces are named `*_s`; text overlays are
`ScreenText_*`; CRT bodies are `*_b` — `projects.js` maps all three to projects.
