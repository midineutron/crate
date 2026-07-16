import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served at the site root by crate-web nginx.
//
// Dev-only backend proxy: set CRATE_BACKEND to a running crate-web (e.g. a
// `kubectl port-forward deploy/crate-web 8091:8080`) and the dev server proxies
// /rest/ (Subsonic) and /audio/ (streams + .fft sidecars) there, so the LOCAL
// patched SPA runs against the REAL Navidrome catalog. Used by tools/sim-test.sh
// for iOS Simulator testing. Ignored by `vite build` (prod is served by nginx).
const backend = process.env.CRATE_BACKEND
const proxy = backend
  ? {
      '/rest': { target: backend, changeOrigin: true },
      '/audio': { target: backend, changeOrigin: true },
    }
  : undefined

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: { host: true, port: 5173, proxy },
  // `vite preview` serves the production build (real service worker + hashed
  // assets) with the same backend proxy — used by tools/sim-offline-test.sh to
  // exercise offline saves/playback on iOS the way prod behaves. preview.proxy
  // is separate from server.proxy, so it must be set explicitly.
  preview: { host: true, port: 4173, proxy },
})
