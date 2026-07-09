import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served under /room/ by crate-web nginx. base makes all asset URLs /room/*.
export default defineConfig({
  base: '/room/',
  plugins: [react()],
  server: { host: true, port: 5173 },
})
