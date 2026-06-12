#!/usr/bin/env node
/**
 * Backfill CLI: enqueue profile-gap question generation for existing users.
 *
 * Historical context: question generation was disabled in production until
 * QUESTIONER_ENABLED was set, so the one-time profile triggers (onboarding)
 * for existing users fired into a void. This script re-enqueues the same
 * profile-mode QuestionerInput that profile.graph.ts emits on save, for every
 * user who has profile gaps and no pending profile question yet.
 *
 * Idempotent: users with a pending profile-mode question are skipped, so
 * re-running the script never stacks duplicates.
 *
 * Requires a running questioner worker (QUESTIONER_ENABLED=true on the
 * server) to drain the queue; the CLI only enqueues.
 *
 * Usage:
 *   bun run maintenance:backfill-profile-questions -- [--network <networkId>] [--limit <n>] [--dry-run]
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { and, eq, sql } from 'drizzle-orm';

import db, { closeDb } from '../lib/drizzle/drizzle';
import { networkMembers, premises, questions, userProfiles, users } from '../schemas/database.schema';
import { questionerQueue } from '../queues/questioner.queue';

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
// Gap computation — mirrors profile.graph.ts save-node logic exactly
// ---------------------------------------------------------------------------

interface ProfileRow {
  userId: string;
  identity: { name?: string; bio?: string; location?: string } | null;
  narrative: { context?: string } | null;
  attributes: { interests?: string[]; skills?: string[] } | null;
}

function computeGaps(profile: ProfileRow): string[] {
  const gaps: string[] = [];
  if (!profile.identity?.location) gaps.push('location');
  if (!profile.attributes?.skills?.length) gaps.push('skills');
  if (!profile.attributes?.interests?.length) gaps.push('interests');
  if (!profile.narrative?.context) gaps.push('current work');
  return gaps;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { networkId, limit, dryRun } = parseArgs();
  console.log(
    `Backfilling profile questions${networkId ? ` for network ${networkId}` : ' for all users'}` +
    `${Number.isFinite(limit) ? ` (limit ${limit})` : ''}${dryRun ? ' (dry run)' : ''}`,
  );

  // Candidate users: onboarded, non-ghost, with a stored profile. Optionally
  // restricted to members of one network.
  const baseConditions = [
    eq(users.isGhost, false),
    sql`${users.onboarding}->>'completedAt' IS NOT NULL`,
  ];

  const rows = networkId
    ? await db
      .select({
        userId: userProfiles.userId,
        identity: userProfiles.identity,
        narrative: userProfiles.narrative,
        attributes: userProfiles.attributes,
      })
      .from(userProfiles)
      .innerJoin(users, eq(userProfiles.userId, users.id))
      .innerJoin(networkMembers, eq(networkMembers.userId, users.id))
      .where(and(...baseConditions, eq(networkMembers.networkId, networkId)))
    : await db
      .select({
        userId: userProfiles.userId,
        identity: userProfiles.identity,
        narrative: userProfiles.narrative,
        attributes: userProfiles.attributes,
      })
      .from(userProfiles)
      .innerJoin(users, eq(userProfiles.userId, users.id))
      .where(and(...baseConditions));

  console.log(`Candidate users with profiles: ${rows.length}`);

  let enqueued = 0;
  let skippedNoGaps = 0;
  let skippedPending = 0;

  for (const row of rows) {
    if (enqueued >= limit) break;

    const gaps = computeGaps(row);
    if (gaps.length === 0) {
      skippedNoGaps += 1;
      continue;
    }

    // Idempotency guard: skip users who already have a pending profile question.
    const [existing] = await db
      .select({ id: questions.id })
      .from(questions)
      .where(and(
        eq(questions.status, 'pending'),
        sql`${questions.detection}->>'mode' = 'profile'`,
        sql`${questions.actors} @> ${JSON.stringify([{ userId: row.userId, role: 'subject' }])}::jsonb`,
      ))
      .limit(1);
    if (existing) {
      skippedPending += 1;
      continue;
    }

    // Active premises let the questioner avoid asking about facts the user
    // has already stated — same payload profile.graph.ts builds on save.
    const activePremises = await db
      .select({ assertion: premises.assertion })
      .from(premises)
      .where(and(eq(premises.userId, row.userId), eq(premises.status, 'ACTIVE')));
    const existingPremises = activePremises.map((p) => p.assertion.text);

    if (dryRun) {
      console.log(`[dry-run] would enqueue ${row.userId} (gaps: ${gaps.join(', ')})`);
      enqueued += 1;
      continue;
    }

    await questionerQueue.addGenerateJob({
      mode: 'profile',
      userId: row.userId,
      sourceType: 'profile',
      sourceId: row.userId,
      context: {
        userProfile: {
          name: row.identity?.name,
          bio: row.identity?.bio,
          location: row.identity?.location,
          skills: row.attributes?.skills,
          interests: row.attributes?.interests,
        },
        gaps,
        existingPremises,
      },
    });
    enqueued += 1;
  }

  console.log(`Done. Enqueued: ${enqueued}, skipped (no gaps): ${skippedNoGaps}, skipped (pending question exists): ${skippedPending}`);
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
