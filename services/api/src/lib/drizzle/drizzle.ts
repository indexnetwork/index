import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../../schemas/database.schema';

import { ensureTestDatabaseReady, hasParentTestDatabaseReadiness } from './test-database-readiness';

declare global {
  var __db: PostgresJsDatabase<typeof schema> | undefined;
}

if (process.env.NODE_ENV === 'test' && !hasParentTestDatabaseReadiness(process.env)) {
  await ensureTestDatabaseReady();
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to initialize Drizzle.');
}

// A deployment (Railway) runs one replica against Neon's pooled endpoint,
// which multiplexes far more app-side connections than a raw Postgres
// max_connections would allow. Local dev talks to a raw, unpooled Postgres
// that's often shared by several worktree processes at once, so it keeps a
// smaller ceiling. DATABASE_POOL_MAX overrides either default.
const isDeployment = process.env.NODE_ENV === 'production'
  || Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME);
const poolMax = Number(process.env.DATABASE_POOL_MAX) || (isDeployment ? 40 : 15);

const client = postgres(connectionString, { prepare: false, max: poolMax });
const db: PostgresJsDatabase<typeof schema> = globalThis.__db || drizzle(client, { schema });

if (process.env.NODE_ENV === 'development') {
  globalThis.__db = db;
}

export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}

export default db;
export type DrizzleDB = typeof db;
