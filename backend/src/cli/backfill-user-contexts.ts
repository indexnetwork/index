#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

const envFile = `.env.development`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { sql } from 'drizzle-orm';

import db, { closeDb } from '../lib/drizzle/drizzle';

/**
 * Backfill CLI: generate missing per-network user contexts.
 *
 * Historically `user_contexts` rows were only generated on enrichment
 * completion or premise rebuilds — joining a network was not a trigger, and
 * the regen handler silently no-ops for users without premises. The result:
 * long-standing members with active premises but no context row for their
 * network, which silently excludes them from context-based discovery.
 *
 * This script finds live members of a network who have at least one ACTIVE
 * premise but no `user_contexts` row for that network, and runs the standard
 * regeneration handler for each (synchronously, in-process — no Redis worker
 * required). The handler regenerates contexts for ALL of the user's networks
 * that are missing or stale, so collateral gaps get fixed too.
 *
 * Requires LLM/embedding env vars (same as the protocol server) since context
 * synthesis and HyDE generation run in-process.
 *
 * Usage:
 *   bun src/cli/backfill-user-contexts.ts --network <networkId> [--dry-run] [--limit N]
 *   DATABASE_URL=<prod> bun src/cli/backfill-user-contexts.ts --network <networkId>
 */

type CandidateRow = {
  user_id: string;
  email: string;
  premise_count: number;
};

function parseArgs(): { networkId: string; dryRun: boolean; limit: number | null } {
  const args = process.argv.slice(2);
  const networkIdx = args.indexOf('--network');
  const networkId = networkIdx !== -1 ? args[networkIdx + 1] : undefined;
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : null;
  if (!networkId) {
    console.error('Usage: bun src/cli/backfill-user-contexts.ts --network <networkId> [--dry-run] [--limit N]');
    process.exit(1);
  }
  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    console.error('--limit must be a positive integer');
    process.exit(1);
  }
  return { networkId, dryRun: args.includes('--dry-run'), limit };
}

const main = async (): Promise<void> => {
  const { networkId, dryRun, limit } = parseArgs();

  const candidates = await db.execute<CandidateRow>(sql`
    SELECT u.id AS user_id, u.email, p.n AS premise_count
    FROM network_members nm
    INNER JOIN users u ON u.id = nm.user_id AND u.deleted_at IS NULL
    INNER JOIN LATERAL (
      SELECT count(*)::int AS n FROM premises p
      WHERE p.user_id = u.id AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
    ) p ON p.n > 0
    WHERE nm.network_id = ${networkId}
      AND nm.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM user_contexts uc
        WHERE uc.user_id = u.id AND uc.network_id = ${networkId}
      )
    ORDER BY p.n DESC
    ${limit !== null ? sql`LIMIT ${limit}` : sql``}
  `);

  console.log(`Members with active premises but no context for network ${networkId}: ${candidates.length}`);
  if (candidates.length === 0) return;

  if (dryRun) {
    for (const c of candidates) {
      console.log(`  [dry-run] ${c.email} (${c.premise_count} premises)`);
    }
    return;
  }

  // Lazy import: the queue module instantiates a module-level BullMQ singleton
  // whose Redis connection would keep the process alive (and is pointless for
  // --dry-run). Only load it when we actually generate.
  const { UserContextQueue } = await import('../queues/usercontext.queue');
  const queue = new UserContextQueue();
  let ok = 0;
  let failed = 0;
  try {
    for (const [i, c] of candidates.entries()) {
      const label = `[${i + 1}/${candidates.length}] ${c.email}`;
      try {
        await queue.processJob('regenerate_contexts', { userId: c.user_id, reason: 'backfill' });
        ok += 1;
        console.log(`  ${label} — done`);
      } catch (err) {
        failed += 1;
        const msg = err instanceof Error ? err.message : `${err}`;
        console.error(`  ${label} — FAILED: ${msg}`);
      }
    }
  } finally {
    await queue.close();
  }

  console.log(`\nBackfill complete: ${ok} succeeded, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
};

main()
  .then(() => closeDb())
  .catch(async (err: unknown) => {
    const msg = err instanceof Error ? err.message : `${err}`;
    console.error('Backfill failed:', msg);
    await closeDb();
    process.exit(1);
  });
