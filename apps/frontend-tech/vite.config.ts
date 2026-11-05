import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  server: {
    port: 5174,
    watch: {
      usePolling: true,
      interval: 100,
    },
    proxy: {
      '/api': { target: 'http://localhost:3001', rewrite: (p) => p.replace(/^\/api/, '') },
      '/ws': { target: 'ws://localhost:3001', ws: true },
    },
  },
});
