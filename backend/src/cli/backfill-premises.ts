#!/usr/bin/env node
/**
 * Backfill CLI: enqueue enrichment jobs for all members of a network.
 * Creates premises (via enrichment) and user contexts for members who lack them.
 *
 * Usage: bun run maintenance:backfill-premises -- --network <networkId> [--dry-run]
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { and, eq, isNull } from 'drizzle-orm';

import db, { closeDb } from '../lib/drizzle/drizzle';
import { networkMembers, users } from '../schemas/database.schema';
import { enrichmentQueue } from '../queues/enrichment.queue';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): { networkId: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const networkArg = args.find((a) => a.startsWith('--network'));
  const dryRun = args.includes('--dry-run');

  let networkId = '';
  if (networkArg) {
    const eqIdx = networkArg.indexOf('=');
    if (eqIdx !== -1) {
      networkId = networkArg.slice(eqIdx + 1);
    } else {
      const nextIdx = args.indexOf(networkArg) + 1;
      if (nextIdx < args.length) networkId = args[nextIdx];
    }
  }

  if (!networkId) {
    console.error('Usage: bun run maintenance:backfill-premises -- --network <networkId> [--dry-run]');
    process.exit(1);
  }

  return { networkId, dryRun };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { networkId, dryRun } = parseArgs();
  console.log(`Backfilling premises for network: ${networkId}${dryRun ? ' (dry run)' : ''}`);

  const members = await db
    .select({ userId: networkMembers.userId })
    .from(networkMembers)
    .innerJoin(users, eq(networkMembers.userId, users.id))
    .where(and(
      eq(networkMembers.networkId, networkId),
      isNull(users.deletedAt),
    ));

  console.log(`Found ${members.length} members in network`);

  if (members.length === 0) {
    console.log('No members to process.');
    return;
  }

  if (dryRun) {
    console.log('Dry run -- no jobs enqueued');
    for (const m of members) {
      console.log(`  Would enqueue: ${m.userId}`);
    }
    return;
  }

  const items = members.map((m) => ({ userId: m.userId }));
  const jobs = await enrichmentQueue.addEnrichUserJobBulk(items);
  console.log(`Enqueued ${jobs.length} enrichment jobs`);
}

main()
  .then(async () => {
    await Promise.all([closeDb(), enrichmentQueue.queue.close()]);
  })
  .catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('backfill-premises error:', msg);
    await Promise.all([
      closeDb().catch(() => {}),
      enrichmentQueue.queue.close().catch(() => {}),
    ]);
    process.exit(1);
  });
