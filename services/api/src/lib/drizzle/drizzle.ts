import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../../schemas/database.schema';

import { ensureTestDatabaseReady } from './test-database-readiness';

declare global {
  var __db: PostgresJsDatabase<typeof schema> | undefined;
}

if (process.env.NODE_ENV === 'test') {
  await ensureTestDatabaseReady();
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to initialize Drizzle.');
}

const client = postgres(connectionString, { prepare: false });
const db: PostgresJsDatabase<typeof schema> = globalThis.__db || drizzle(client, { schema });

if (process.env.NODE_ENV === 'development') {
  globalThis.__db = db;
}

export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}

export default db;
export type DrizzleDB = typeof db;
