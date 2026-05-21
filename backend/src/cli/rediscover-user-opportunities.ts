#!/usr/bin/env node
/**
 * Rediscover opportunities for a specific user.
 *
 * Wipes the user's prior discovery state so the new run isn't dedup-skipped or
 * polluted by stale negotiation tasks, then enqueues a fresh discovery job per
 * active intent with a unique jobId to bypass the 6h queue-level dedupe key.
 *
 * Cleanup order (FK-safe):
 *   1. Delete negotiation tasks tied to those opportunities (artifacts cascade,
 *      messages set NULL on task_id). Done by matching metadata->>'opportunityId'.
 *   2. Delete the opportunity rows themselves (opportunity_deliveries cascade).
 *
 * Usage:
 *   bun src/cli/rediscover-user-opportunities.ts <userId>
 *   bun run maintenance:rediscover-opportunities -- <userId>
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import db, { closeDb } from '../lib/drizzle/drizzle';
import { intents, opportunities, users } from '../schemas/database.schema';
import { tasks } from '../schemas/conversation.schema';
import { fromIntentQueue } from '../queues/opportunity/from-intent.queue';

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error('Usage: bun src/cli/rediscover-user-opportunities.ts <userId>');
    process.exit(1);
  }

  const userRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (userRows.length === 0) {
    console.error(`[rediscover] User ${userId} not found (or soft-deleted).`);
    process.exit(1);
  }

  const oppRows = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(sql`${opportunities.actors} @> ${JSON.stringify([{ userId }])}::jsonb`);
  const oppIds = oppRows.map((o) => o.id);

  if (oppIds.length > 0) {
    const deletedTasks = await db
      .delete(tasks)
      .where(
        and(
          sql`${tasks.metadata}->>'type' = 'negotiation'`,
          inArray(sql`${tasks.metadata}->>'opportunityId'`, oppIds),
        ),
      )
      .returning({ id: tasks.id });
    console.log(
      `[rediscover] Deleted ${deletedTasks.length} negotiation task(s) tied to those opportunities.`,
    );
  }

  const deleted = await db
    .delete(opportunities)
    .where(sql`${opportunities.actors} @> ${JSON.stringify([{ userId }])}::jsonb`)
    .returning({ id: opportunities.id });
  console.log(`[rediscover] Deleted ${deleted.length} opportunity row(s) involving user ${userId}.`);

  const activeIntents = await db
    .select({ id: intents.id })
    .from(intents)
    .where(and(eq(intents.userId, userId), isNull(intents.archivedAt)));
  console.log(`[rediscover] Found ${activeIntents.length} active intent(s) for user ${userId}.`);

  const stamp = Date.now();
  let enqueued = 0;
  for (const { id: intentId } of activeIntents) {
    await fromIntentQueue.addJob(
      { intentId, userId },
      { priority: 10, jobId: `manual-rediscovery-${userId}-${intentId}-${stamp}` },
    );
    enqueued++;
  }
  console.log(`[rediscover] Enqueued ${enqueued} discovery job(s).`);

  await fromIntentQueue.queue.close();
  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error('[rediscover] Fatal error:', err);
  process.exit(1);
});
