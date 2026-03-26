#!/usr/bin/env node
/**
 * One-time backfill: rename `consensus` to `hasOpportunity` in negotiation
 * outcome artifacts (JSONB `parts` column).
 *
 * Usage: bun run protocol/src/cli/backfill-consensus-to-has-opportunity.ts [--dry-run]
 *
 * With --dry-run, reports how many rows would be updated without modifying data.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(import.meta.dir, '../../.env.development') });

import { sql } from 'drizzle-orm';
import db from '../lib/drizzle/drizzle';

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  const countResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM artifacts
    WHERE parts->0->>'kind' = 'data'
      AND parts->0->'data' ? 'consensus'
      AND NOT (parts->0->'data' ? 'hasOpportunity')
  `);
  const count = parseInt((countResult[0] as { count: string })?.count ?? '0', 10);
  console.log(`Found ${count} artifact(s) with legacy "consensus" field`);

  if (isDryRun) {
    console.log('Dry run — no changes made');
    return;
  }

  if (count === 0) {
    console.log('Nothing to backfill');
    return;
  }

  const updateResult = await db.execute(sql`
    UPDATE artifacts
    SET parts = jsonb_set(
      parts #- '{0,data,consensus}',
      '{0,data,hasOpportunity}',
      parts->0->'data'->'consensus'
    )
    WHERE parts->0->>'kind' = 'data'
      AND parts->0->'data' ? 'consensus'
      AND NOT (parts->0->'data' ? 'hasOpportunity')
  `);

  console.log(`Updated ${(updateResult as unknown[]).length ?? 0} artifact(s)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
