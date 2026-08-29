#!/usr/bin/env bun
/**
 * Enqueue the guarded IND-586 reconciliation for explicitly named dev intents.
 *
 * This command intentionally has no broad sweep mode and refuses production.
 * Run only after the fixed API is deployed and verified on dev:
 *
 * bun run maintenance:reconcile-orphaned-intent-indexing -- --confirm-dev --intent <uuid> --intent <uuid>
 */
import { closeDb } from '../lib/drizzle/drizzle';
import { reconcileOrphanedIntent } from '../queues/intent.queue';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';

function valuesFor(flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && process.argv[index + 1]) values.push(process.argv[index + 1]!);
  }
  return values;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to reconcile production data');
  }
  if (!process.argv.includes('--confirm-dev')) {
    throw new Error('Pass --confirm-dev after the deployed dev fix has been verified');
  }
  const intentIds = valuesFor('--intent');
  if (intentIds.length === 0) {
    throw new Error('Provide one or more explicit --intent UUID values; broad reconciliation is intentionally unavailable');
  }

  const adapter = new ChatDatabaseAdapter();
  for (const intentId of intentIds) {
    const intent = await adapter.getIntentForIndexing(intentId);
    if (!intent) throw new Error(`Intent not found: ${intentId}`);
    if (intent.archivedAt || (intent.status != null && intent.status !== 'ACTIVE')) {
      throw new Error(`Intent is not active and cannot be reconciled: ${intentId}`);
    }
    await reconcileOrphanedIntent({ intentId, userId: intent.userId });
    console.log(`Reconciled orphaned intent ${intentId}`);
  }
}

main()
  .then(async () => {
    await closeDb();
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    await closeDb().catch(() => {});
    process.exit(1);
  });
