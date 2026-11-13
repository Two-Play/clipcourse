// SPDX-License-Identifier: MIT
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2019',
    sourcemap: true,
    lib: {
      entry: 'src/index.ts',
      name: 'ClipcoursePlayer',
      formats: ['es', 'iife'],
      fileName: (fmt) => `clipcourse-player.${fmt === 'es' ? 'mjs' : 'iife.js'}`,
    },
  },
});
