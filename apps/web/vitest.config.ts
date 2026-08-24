import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    server: {
      deps: {
        // zod's entry re-exports its API as a namespace binding (`export { z }`),
        // which the externalized-module interop drops under the Bun-run vitest
        // pipeline (z arrives undefined). Inlining runs it through the vite
        // transform, which preserves the binding.
        inline: ['zod'],
      },
    },
  },
});
