import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: run `npx wrangler dev` in app-worker/ (port 8787); /api is proxied to it.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: { '/api': 'http://localhost:8787' } },
  test: { environment: 'jsdom', setupFiles: ['./test/setup.js'] },
})
