import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../../schemas/database.schema';

declare global {
  var __db: PostgresJsDatabase<typeof schema> | undefined;
}

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db: PostgresJsDatabase<typeof schema> = globalThis.__db || drizzle(client, { schema });

if (process.env.NODE_ENV === 'development') {
  globalThis.__db = db;
}

export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}


export default db;
export type DrizzleDB = typeof db;
