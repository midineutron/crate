import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served at the site root by crate-web nginx.
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: { host: true, port: 5173 },
})
