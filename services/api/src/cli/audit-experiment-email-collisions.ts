#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

const envFile = `.env.development`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { sql } from 'drizzle-orm';

import db, { closeDb } from '../lib/drizzle/drizzle';

/**
 * Audits the `users` table for case-insensitive email collisions among
 * non-deleted users. Run before dropping the `experimentNetworkId` column
 * in Phase 5.2 of the network-scoped personal agents migration. If any
 * collisions are reported, an operator must resolve them manually before
 * the column drop is safe.
 *
 * @returns Resolves when the audit completes; calls process.exit(1) on collisions.
 */
const main = async (): Promise<void> => {
  const rows = await db.execute<{ email: string; n: number }>(sql`
    SELECT lower(email) AS email, count(*) AS n
    FROM users
    WHERE deleted_at IS NULL
    GROUP BY lower(email)
    HAVING count(*) > 1
    ORDER BY count(*) DESC, lower(email) ASC
  `);

  if (rows.length === 0) {
    console.log('No email collisions; safe to drop experimentNetworkId.');
    return;
  }

  console.error(`Found ${rows.length} colliding email(s). Resolve before migration:`);
  for (const r of rows) {
    console.error(`  ${r.email} (${r.n} rows)`);
  }
  process.exit(1);
};

main()
  .then(() => closeDb())
  .catch(async (err: unknown) => {
    const msg = err instanceof Error ? err.message : `${err}`;
    console.error('Audit failed:', msg);
    await closeDb();
    process.exit(1);
  });
