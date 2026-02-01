import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Build the frontend directly into the Fastify static directory.
// Fastify serves `/static/*` from `src/api/static/*`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: path.join(__dirname, 'src', 'ui', 'app'),
  base: '/static/app/',
  build: {
    outDir: path.join(__dirname, 'src', 'api', 'static', 'app'),
    emptyOutDir: true,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
