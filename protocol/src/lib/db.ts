import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

declare global {
  var __db: ReturnType<typeof drizzle> | undefined;
}

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = globalThis.__db || drizzle(client, { schema });

if (process.env.NODE_ENV === 'development') {
  globalThis.__db = db;
}

export default db; 