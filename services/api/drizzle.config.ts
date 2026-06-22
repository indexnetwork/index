import dotenv from 'dotenv';
import path from 'path';
import { defineConfig } from 'drizzle-kit';

dotenv.config({ path: path.resolve(__dirname, './.env.development') });

export default defineConfig({
  schema: './src/schemas/database.schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
}); 