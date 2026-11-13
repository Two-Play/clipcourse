// SPDX-License-Identifier: MIT
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // Serve the repository's example courses as static files.
  publicDir: fileURLToPath(new URL('../../examples', import.meta.url)),
  server: { port: 4317, strictPort: true },
  preview: { port: 4317, strictPort: true },
});
