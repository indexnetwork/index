import dotenv from 'dotenv';
import path from 'path';
import { defineConfig } from 'drizzle-kit';

// Runtime env files live at the repo root (see root .env.example).
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env.development';
dotenv.config({
  path: path.resolve(__dirname, `../../${envFile}`),
  override: process.env.NODE_ENV === 'test',
});

if (process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_SAFE !== '1') {
  throw new Error(
    'Refusing test migrations because TEST_DATABASE_SAFE=1 is not set. Configure a dedicated disposable test database.',
  );
}

export default defineConfig({
  schema: './src/schemas/database.schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
}); 