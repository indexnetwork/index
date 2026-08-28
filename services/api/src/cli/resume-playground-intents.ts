#!/usr/bin/env node
/**
 * Resume every paused, non-archived intent in the local playground.
 *
 * Each intent goes through the normal lifecycle transition rather than a bulk
 * database update, so its resume-discovery job is enqueued as well.
 *
 * Usage: bun src/cli/resume-playground-intents.ts --confirm
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(import.meta.dir, '../../../..', '.env.development') });

async function main(): Promise<void> {
  if (!process.argv.includes('--confirm')) {
    throw new Error('This resumes every paused playground intent. Re-run with --confirm.');
  }

  const [{ and, eq, isNull }, { default: db, closeDb }, { intentService }, { intents }, { discoveryQueue }] = await Promise.all([
    import('drizzle-orm/sql'),
    import('../lib/drizzle/drizzle'),
    import('../services/intent.service'),
    import('../schemas/database.schema'),
    import('../queues/opportunity/discovery.queue'),
  ]);

  const pausedIntents = await db
    .select({ id: intents.id, userId: intents.userId })
    .from(intents)
    .where(and(eq(intents.status, 'PAUSED'), isNull(intents.archivedAt)));

  const outcomes = await Promise.all(pausedIntents.map(({ id, userId }) => (
    intentService.transitionStatus(id, userId, 'ACTIVE')
  )));
  const resumed = outcomes.filter((outcome) => outcome.kind === 'success' && outcome.changed).length;
  const failed = outcomes.filter((outcome) => outcome.kind !== 'success');

  await discoveryQueue.queue.close();
  await closeDb();

  if (failed.length > 0) {
    throw new Error(`Failed to resume ${failed.length} of ${pausedIntents.length} paused intent(s).`);
  }

  console.log(`[playground] Resumed ${resumed} intent(s) and enqueued discovery for each one.`);
}

main().catch((error) => {
  console.error('[playground] Resume failed:', error);
  process.exit(1);
});
