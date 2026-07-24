#!/usr/bin/env node
/**
 * One-shot backfill: stamps `metadata.archivedAt` on every pre-v2 legacy
 * negotiation task so reader-side filters can hide them from user-facing APIs.
 *
 * "Old negotiation" predicate:
 *   metadata->>'type' = 'negotiation'
 *   AND metadata->>'protocolVersion' IS NULL   ← v2 tasks always set this
 *   AND metadata->>'archivedAt' IS NULL         ← idempotency guard
 *
 * Safety:
 *   - Nothing is deleted; archivedAt is an additive JSONB field.
 *   - The `archivedAt IS NULL` guard makes re-runs safe (only unarchived rows
 *     are touched — re-running is a no-op once complete).
 *   - The UPDATE runs inside a single transaction so it's atomic.
 *
 * Usage:
 *   bun src/cli/archive-legacy-negotiations.ts [--dry-run]
 *   bun run maintenance:archive-legacy-negotiations [-- --dry-run]
 *
 * ⚠️  DO NOT run this against production without explicit approval from the
 *     wave root agent.  This script is shipped in PR feat/archive-legacy-
 *     negotiations and is intentionally NOT executed during this wave.
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(import.meta.dir, '../../../..', envFile) });

import { sql } from 'drizzle-orm/sql';

import db, { closeDb } from '../lib/drizzle/drizzle';
import { tasks } from '../schemas/conversation.schema';

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(`[archive-legacy-negotiations] mode=${isDryRun ? 'DRY RUN' : 'WRITE'}`);

  // Always count first so we can report what would be affected.
  const [countRow] = await db
    .select({ count: sql<string>`count(*)` })
    .from(tasks)
    .where(sql`
      ${tasks.metadata}->>'type' = 'negotiation'
      AND ${tasks.metadata}->>'protocolVersion' IS NULL
      AND ${tasks.metadata}->>'archivedAt' IS NULL
    `);

  const matchCount = Number(countRow?.count ?? 0);
  console.log(`[archive-legacy-negotiations] matched ${matchCount} pre-v2 task(s) to archive`);

  if (matchCount === 0) {
    console.log('[archive-legacy-negotiations] Nothing to archive — exiting.');
    await closeDb();
    process.exit(0);
  }

  if (isDryRun) {
    console.log('[archive-legacy-negotiations] DRY RUN — no rows were written.');
    await closeDb();
    process.exit(0);
  }

  // Execute the backfill inside a transaction so it's all-or-nothing.
  const archivedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    const result = await tx
      .update(tasks)
      .set({
        metadata: sql`${tasks.metadata} || jsonb_build_object('archivedAt', ${archivedAt}::text)`,
      })
      .where(sql`
        ${tasks.metadata}->>'type' = 'negotiation'
        AND ${tasks.metadata}->>'protocolVersion' IS NULL
        AND ${tasks.metadata}->>'archivedAt' IS NULL
      `)
      .returning({ id: tasks.id });

    console.log(`[archive-legacy-negotiations] Stamped archivedAt=${archivedAt} on ${result.length} task(s).`);

    if (result.length !== matchCount) {
      // If the count differs, a concurrent write landed between our SELECT and
      // UPDATE.  The archivedAt IS NULL guard in the UPDATE still ensures we
      // only stamp rows that weren't already archived; report the discrepancy.
      console.warn(
        `[archive-legacy-negotiations] Count mismatch: expected ${matchCount}, wrote ${result.length}.` +
        ' A concurrent update may have archived some rows first (safe — re-run is idempotent).',
      );
    }
  });

  console.log('[archive-legacy-negotiations] Done.');
  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error('[archive-legacy-negotiations] Fatal error:', err);
  process.exit(1);
});
