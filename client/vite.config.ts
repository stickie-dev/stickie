import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { configuredDevPort, configuredPort } from '../server/src/config'

// the server's own reading of both ports, so Vite, `stickie`, the desktop app
// and the MCP bridge agree: STICKIE_PORT and STICKIE_DEV_PORT, else what
// ~/.stickie/config.json says, else 4870 and 5173
const api_port = String(configuredPort())

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: configuredDevPort(),
    strictPort: true,
    proxy: {
      '/api': `http://localhost:${api_port}`,
      '/ws': { target: `ws://localhost:${api_port}`, ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
})
