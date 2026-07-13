import dotenv from 'dotenv';
import path from 'path';
import { defineConfig } from 'drizzle-kit';

// Runtime env files live at the repo root (see root .env.example).
dotenv.config({ path: path.resolve(__dirname, '../../.env.development') });

export default defineConfig({
  schema: './src/schemas/database.schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
}); 