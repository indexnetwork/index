import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      /**
       * Test-only shim for zod's entry point.
       *
       * Tests that read a fixture through the ops core's own `parseEvalArtifact`
       * pull packages/protocol/eval/shared/artifact.ts, which does
       * `import { z } from "zod"`. zod's ESM entry publishes that name as
       * `import * as z from "./v3/external.js"; export { z }`, and re-exporting a
       * namespace import that way is the one binding `bun --bun vitest` loses:
       * the import arrives as `undefined` and the schema module dies on
       * `z.string()`. Node's vitest resolves it correctly, and so does plain
       * `bun`, so this is a runner interop gap and not a zod or protocol bug.
       *
       * The shim rebuilds the same binding from zod's flat v3 exports, which
       * survive. Test-only on purpose: it lives in vitest.config.ts and not
       * vite.config.ts, so nothing about the shipped bundle changes — the app
       * imports no zod at all (see src/api/client.ts on why).
       */
      { find: /^zod$/, replacement: path.resolve(__dirname, './tests/shims/zod.ts') },
    ],
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
  },
});
