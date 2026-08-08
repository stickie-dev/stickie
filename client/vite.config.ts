import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': 'http://localhost:4870',
      '/ws': { target: 'ws://localhost:4870', ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
})
