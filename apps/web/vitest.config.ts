import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Mirrors vite.config.ts: resolve the reporter kickoff marker from source
      // so tests never depend on a built packages/protocol/dist.
      '@indexnetwork/protocol': path.resolve(
        __dirname,
        '../../packages/protocol/src/chat/reporter.prompt.ts',
      ),
    },
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
  },
});
