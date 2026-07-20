import path from 'path';
import { defineConfig } from 'drizzle-kit';

import { loadEnvironmentWithTestLock, requireSafeTestMigration } from './src/lib/env/test-environment';

// Runtime env files live at the repo root (see root .env.example). Test mode is
// captured before dotenv runs so .env.test cannot downgrade migration safety.
const rootDirectory = path.resolve(__dirname, '../..');
const loadedEnvironment = loadEnvironmentWithTestLock({
  requestedNodeEnv: process.env.NODE_ENV,
  testEnvPath: path.join(rootDirectory, '.env.test'),
  developmentEnvPath: path.join(rootDirectory, '.env.development'),
});

requireSafeTestMigration(loadedEnvironment.testMode, process.env.TEST_DATABASE_SAFE);

export default defineConfig({
  schema: './src/schemas/database.schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
}); 