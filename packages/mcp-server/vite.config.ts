// SPDX-License-Identifier: AGPL-3.0-only
import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

/** Bundles the CLI into one Node script (workspace packages inlined). */
export default defineConfig({
  build: {
    ssr: 'src/cli.ts',
    target: 'node22',
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      external: [
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
        /^@modelcontextprotocol\/sdk/,
        'zod',
      ],
      output: { entryFileNames: 'clipcourse-mcp.js', banner: '#!/usr/bin/env node' },
    },
  },
  ssr: { noExternal: [/^@clipcourse\//, 'valibot', 'fflate', 'immer', 'zustand'] },
});
