// SPDX-License-Identifier: AGPL-3.0-only
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Example courses are served so "Open example" works offline.
  publicDir: fileURLToPath(new URL('../../examples', import.meta.url)),
  server: { port: 4318, strictPort: true },
  preview: { port: 4318, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
});
