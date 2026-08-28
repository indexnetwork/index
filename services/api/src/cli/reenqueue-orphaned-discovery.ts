#!/usr/bin/env bun
/**
 * Re-enqueue discovery for intents stranded by the #1542 queue rename.
 *
 * Renaming the BullMQ queue (`opportunity-from-intent` → `opportunity-discovery`)
 * moved the key space, so every job waiting or delayed on the old name was
 * orphaned at cutover. Those intents keep an `intent_discovery_progress` row at
 * `queued` with `first_discovery_succeeded_at` still null, and look permanently
 * "warming" until something enqueues them again.
 *
 * Prints the affected intents and exits; pass --confirm-dev to enqueue them.
 * The staleness floor keeps jobs enqueued after the cutover out of the sweep.
 *
 *   railway run --environment dev --service protocol \
 *     bun services/api/src/cli/reenqueue-orphaned-discovery.ts --confirm-dev
 */
import { and, eq, isNull, lt } from 'drizzle-orm';

import db, { closeDb } from '../lib/drizzle/drizzle';
import { intents, intentDiscoveryProgress } from '../schemas/database.schema';
import { discoveryQueue } from '../queues/opportunity/discovery.queue';

function numberFlag(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const parsed = Number(process.argv[index + 1]);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} needs a positive number of minutes`);
  return parsed;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to sweep production data');
  }

  const staleMinutes = numberFlag('--stale-minutes', 15);
  const staleBefore = new Date(Date.now() - staleMinutes * 60 * 1000);

  const stranded = await db
    .select({ intentId: intentDiscoveryProgress.intentId, userId: intentDiscoveryProgress.userId })
    .from(intentDiscoveryProgress)
    .innerJoin(intents, eq(intents.id, intentDiscoveryProgress.intentId))
    .where(and(
      eq(intentDiscoveryProgress.status, 'queued'),
      lt(intentDiscoveryProgress.updatedAt, staleBefore),
      isNull(intents.firstDiscoverySucceededAt),
      isNull(intents.archivedAt),
      eq(intents.status, 'ACTIVE'),
    ));

  if (stranded.length === 0) {
    console.log(`No stranded intents: nothing queued before ${staleBefore.toISOString()}.`);
    return;
  }

  if (!process.argv.includes('--confirm-dev')) {
    console.log(`${stranded.length} stranded intent(s) queued before ${staleBefore.toISOString()}:`);
    for (const { intentId } of stranded) console.log(`  ${intentId}`);
    console.log('Re-run with --confirm-dev to enqueue discovery for each one.');
    return;
  }

  for (const { intentId, userId } of stranded) {
    await discoveryQueue.addJob({ intentId, userId });
    console.log(`Enqueued discovery for ${intentId}`);
  }
  console.log(`Re-enqueued ${stranded.length} stranded intent(s).`);
}

main()
  .then(async () => {
    await discoveryQueue.close();
    await closeDb();
    // The queue factory's Redis connection outlives close() and keeps the event
    // loop alive; a one-shot maintenance command exits rather than hanging.
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    await discoveryQueue.close().catch(() => {});
    await closeDb().catch(() => {});
    process.exit(1);
  });
