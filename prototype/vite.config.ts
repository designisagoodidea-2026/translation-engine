import { defineConfig } from 'vite';

// Vite serves the SPA only. In dev, /api is proxied to the local Worker
// (run separately via `npm run dev:worker`). In production, the Worker
// serves both the API and the built SPA assets in one deploy.
export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
});
