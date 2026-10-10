import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // 127.0.0.1, not localhost: Node may resolve localhost to ::1, which the
      // loopback-only server refuses. changeOrigin rewrites Host to pass the Host check.
      '/api': { target: 'http://127.0.0.1:3200', changeOrigin: true },
      '/auth': { target: 'http://127.0.0.1:3200', changeOrigin: true },
    },
  },
});
