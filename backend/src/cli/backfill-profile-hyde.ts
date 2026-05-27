#!/usr/bin/env node
/**
 * Backfill CLI: enqueue profile HyDE jobs for index members who have a user_profiles
 * row but no profile HyDE document (hyde_documents with sourceType = 'profile').
 *
 * Usage: bun run maintenance:backfill-profile-hyde [--limit=N]
 * Default limit: 500.
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { and, eq, isNull } from 'drizzle-orm';

import db, { closeDb } from '../lib/drizzle/drizzle';
import { hydeDocuments, networkMembers, userProfiles } from '../schemas/database.schema';
import { enrichmentQueue } from '../queues/enrichment.queue';

const DEFAULT_LIMIT = 500;

function parseLimit(): number {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  if (limitArg) {
    const val = parseInt(limitArg.split('=')[1], 10);
    if (!Number.isNaN(val) && val > 0) return val;
  }
  return DEFAULT_LIMIT;
}

/**
 * Users who are index members, have a user profile, and lack a profile HyDE document.
 */
async function getNetworkMembersMissingProfileHyde(limit: number): Promise<{ userId: string }[]> {
  const rows = await db
    .selectDistinct({ userId: userProfiles.userId })
    .from(networkMembers)
    .innerJoin(userProfiles, eq(networkMembers.userId, userProfiles.userId))
    .leftJoin(
      hydeDocuments,
      and(eq(hydeDocuments.sourceId, userProfiles.userId), eq(hydeDocuments.sourceType, 'profile')),
    )
    .where(isNull(hydeDocuments.id))
    .limit(limit);
  return rows;
}

async function main(): Promise<void> {
  const limit = parseLimit();
  const users = await getNetworkMembersMissingProfileHyde(limit);

  if (users.length === 0) {
    console.log('No index members missing profile HyDE.');
    return;
  }

  let enqueued = 0;
  for (const { userId } of users) {
    await enrichmentQueue.addEnsureProfileHydeJob({ userId });
    enqueued++;
  }

  console.log(`Enqueued profile HyDE jobs: ${enqueued}`);
}

main()
  .then(async () => {
    await Promise.all([closeDb(), enrichmentQueue.queue.close()]);
  })
  .catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('backfill-profile-hyde error:', msg);
    await Promise.all([
      closeDb().catch(() => {}),
      enrichmentQueue.queue.close().catch(() => {}),
    ]);
    process.exit(1);
  });
