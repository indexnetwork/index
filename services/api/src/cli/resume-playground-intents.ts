#!/usr/bin/env node
/**
 * Resume every paused, non-archived intent in the local playground.
 *
 * Each intent goes through the normal lifecycle transition rather than a bulk
 * database update, so its resume discovery runs as well — triggered
 * fire-and-forget, in this process, so this script polls the first-discovery
 * stamp until every resumed intent's scan finishes before closing the DB pool.
 *
 * Usage: bun src/cli/resume-playground-intents.ts --confirm
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(import.meta.dir, '../../../..', '.env.development') });

const DISCOVERY_WAIT_TIMEOUT_MS = 5 * 60_000;
const DISCOVERY_POLL_INTERVAL_MS = 2_000;

async function main(): Promise<void> {
  if (!process.argv.includes('--confirm')) {
    throw new Error('This resumes every paused playground intent. Re-run with --confirm.');
  }

  const [{ and, eq, isNull, isNotNull, inArray }, { default: db, closeDb }, { intentService }, { intents }] = await Promise.all([
    import('drizzle-orm/sql'),
    import('../lib/drizzle/drizzle'),
    import('../services/intent.service'),
    import('../schemas/database.schema'),
  ]);

  const pausedIntents = await db
    .select({ id: intents.id, userId: intents.userId })
    .from(intents)
    .where(and(eq(intents.status, 'PAUSED'), isNull(intents.archivedAt)));

  const outcomes = await Promise.all(pausedIntents.map(({ id, userId }) => (
    intentService.transitionStatus(id, userId, 'ACTIVE')
  )));
  const resumedIds = pausedIntents
    .filter((_intent, index) => outcomes[index]?.kind === 'success' && outcomes[index]?.changed)
    .map(({ id }) => id);
  const failed = outcomes.filter((outcome) => outcome.kind !== 'success');

  // Discovery for each resumed intent runs in the background, in this process
  // — wait for its first-discovery stamp before closing the DB pool, or the
  // scans get killed mid-flight. Only intents that have never completed a scan
  // are observable this way; an already-stamped intent is not waited on.
  const pending = new Set(
    resumedIds.length === 0 ? [] : (await db
      .select({ id: intents.id })
      .from(intents)
      .where(and(inArray(intents.id, resumedIds), isNull(intents.firstDiscoverySucceededAt)))
    ).map(({ id }) => id),
  );
  const waitDeadline = Date.now() + DISCOVERY_WAIT_TIMEOUT_MS;
  while (pending.size > 0 && Date.now() < waitDeadline) {
    await Bun.sleep(DISCOVERY_POLL_INTERVAL_MS);
    const stamped = await db
      .select({ id: intents.id })
      .from(intents)
      .where(and(inArray(intents.id, [...pending]), isNotNull(intents.firstDiscoverySucceededAt)));
    for (const row of stamped) pending.delete(row.id);
  }
  if (pending.size > 0) {
    console.warn(`[playground] Timed out waiting for discovery on ${pending.size} intent(s), closing anyway: ${[...pending].join(', ')}`);
  }

  await closeDb();

  if (failed.length > 0) {
    throw new Error(`Failed to resume ${failed.length} of ${pausedIntents.length} paused intent(s).`);
  }

  console.log(`[playground] Resumed ${resumedIds.length} intent(s); discovery ran for each.`);
}

main().catch((error) => {
  console.error('[playground] Resume failed:', error);
  process.exit(1);
});
