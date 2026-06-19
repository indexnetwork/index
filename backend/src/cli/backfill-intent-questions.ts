#!/usr/bin/env node
/**
 * Backfill CLI: enqueue intent-refinement question generation for existing users.
 *
 * Intent-mode questions are normally generated at intent creation time
 * (intent.graph.ts), but that trigger fired while QUESTIONER_ENABLED was off
 * in production, so existing intents never produced questions. This script
 * enqueues the same intent-mode QuestionerInput for each user's most recent
 * active intent.
 *
 * One job per user (most recent active intent), not per intent: digests
 * deliver at most one question per day with a re-delivery cooldown, so
 * enqueueing every intent would only build a stale backlog.
 *
 * Idempotent: users with a pending intent-mode question are skipped, so
 * re-running the script never stacks duplicates.
 *
 * Requires a running questioner worker (QUESTIONER_ENABLED=true on the
 * server) to drain the queue; the CLI only enqueues.
 *
 * Usage:
 *   bun run maintenance:backfill-intent-questions -- [--network <networkId>] [--limit <n>] [--dry-run]
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import db, { closeDb } from '../lib/drizzle/drizzle';
import { intents, networkMembers, questions, users } from '../schemas/database.schema';
import { questionerQueue } from '../queues/questioner.queue';
import { ensureGlobalUserContext } from '../lib/usercontext/global-context';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function argValue(args: string[], name: string): string | undefined {
  const exact = args.indexOf(name);
  if (exact !== -1 && exact + 1 < args.length) return args[exact + 1];
  const prefixed = args.find((a) => a.startsWith(`${name}=`));
  return prefixed?.slice(name.length + 1);
}

function parseArgs(): { networkId?: string; limit: number; dryRun: boolean } {
  const args = process.argv.slice(2);
  const networkId = argValue(args, '--network');
  const limitRaw = argValue(args, '--limit');
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : Number.POSITIVE_INFINITY;
  if (limitRaw && (!Number.isFinite(limit) || limit <= 0)) {
    console.error('--limit must be a positive integer');
    process.exit(1);
  }
  return { networkId, limit, dryRun: args.includes('--dry-run') };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { networkId, limit, dryRun } = parseArgs();
  console.log(
    `Backfilling intent questions${networkId ? ` for network ${networkId}` : ' for all users'}` +
    `${Number.isFinite(limit) ? ` (limit ${limit})` : ''}${dryRun ? ' (dry run)' : ''}`,
  );

  // Active intents of onboarded, non-ghost users, newest first. Optionally
  // restricted to members of one network. The newest-first ordering plus the
  // per-user dedup below selects each user's most recent active intent.
  const baseConditions = [
    isNull(intents.archivedAt),
    eq(users.isGhost, false),
    sql`${users.onboarding}->>'completedAt' IS NOT NULL`,
  ];

  const selection = {
    intentId: intents.id,
    payload: intents.payload,
    summary: intents.summary,
    userId: intents.userId,
  };

  const rows = networkId
    ? await db
      .select(selection)
      .from(intents)
      .innerJoin(users, eq(intents.userId, users.id))
      .innerJoin(networkMembers, eq(networkMembers.userId, users.id))
      .where(and(...baseConditions, eq(networkMembers.networkId, networkId)))
      .orderBy(desc(intents.createdAt))
    : await db
      .select(selection)
      .from(intents)
      .innerJoin(users, eq(intents.userId, users.id))
      .where(and(...baseConditions))
      .orderBy(desc(intents.createdAt));

  // Most recent active intent per user.
  const latestByUser = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (!latestByUser.has(row.userId)) latestByUser.set(row.userId, row);
  }

  console.log(`Users with active intents: ${latestByUser.size}`);

  let enqueued = 0;
  let skippedPending = 0;

  for (const row of latestByUser.values()) {
    if (enqueued >= limit) break;

    // Idempotency guard: skip users who already have a pending intent question.
    const [existing] = await db
      .select({ id: questions.id })
      .from(questions)
      .where(and(
        eq(questions.status, 'pending'),
        sql`${questions.detection}->>'mode' = 'intent'`,
        sql`${questions.actors} @> ${JSON.stringify([{ userId: row.userId, role: 'subject' }])}::jsonb`,
      ))
      .limit(1);
    if (existing) {
      skippedPending += 1;
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] would enqueue ${row.userId} (intent ${row.intentId}: ${row.payload.slice(0, 60)}…)`);
      enqueued += 1;
      continue;
    }

    // Same payload shape intent.graph.ts emits on intent creation, plus the
    // stored summary (available for existing intents, absent at create time).
    await questionerQueue.addGenerateJob({
      mode: 'intent',
      userId: row.userId,
      sourceType: 'intent',
      sourceId: row.intentId,
      context: {
        intentId: row.intentId,
        payload: row.payload,
        ...(row.summary ? { summary: row.summary } : {}),
        userContext: await ensureGlobalUserContext(row.userId),
      },
    });
    enqueued += 1;
  }

  console.log(`Done. Enqueued: ${enqueued}, skipped (pending question exists): ${skippedPending}`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await questionerQueue.queue.close();
    await closeDb();
  });
