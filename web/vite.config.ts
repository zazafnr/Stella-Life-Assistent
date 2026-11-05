import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // @stella/web-core: die gemeinsamen Oberflächen-Bausteine (Quellcode, kein Build-Schritt)
  resolve: { alias: { '@stella/web-core': path.resolve(import.meta.dirname, '../web-core/src') } },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
});
