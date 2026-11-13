// SPDX-License-Identifier: MIT
import { defineConfig } from 'vite';

/** Builds the single script that runs an exported course. */
export default defineConfig({
  build: {
    target: 'es2019',
    sourcemap: false,
    lib: {
      entry: 'src/boot.ts',
      name: 'ClipcourseRuntime',
      formats: ['iife'],
      fileName: () => 'clipcourse-runtime.iife.js',
    },
  },
});
