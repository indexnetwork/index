#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

const envFile = `.env.development`;
dotenv.config({ path: path.resolve(import.meta.dir, '../../../..', envFile) });

import { and, eq, isNull } from 'drizzle-orm';
import db, { closeDb } from '../lib/drizzle/drizzle';
import { ensureLoopsMemberProperties, syncMemberToLoops } from '../lib/loops';
import { networkMembers, users } from '../schemas/database.schema';

/**
 * Backfills existing Index Early network members into the Loops audience with
 * `indexMember: true` and `indexMemberSince` (their join date). The
 * addMemberToNetwork hook keeps Loops current from then on; this catches
 * everyone who joined before it.
 *
 * Requires LOOPS_API_KEY and INDEX_EARLY_NETWORK_ID. Dry run by default;
 * pass --confirm to write.
 */
async function main() {
  const confirm = process.argv.includes('--confirm');

  if (!process.env.LOOPS_API_KEY?.trim()) {
    console.error('❌ LOOPS_API_KEY is not set');
    process.exit(1);
  }
  const indexEarlyNetworkId = process.env.INDEX_EARLY_NETWORK_ID?.trim();
  if (!indexEarlyNetworkId) {
    console.error('❌ INDEX_EARLY_NETWORK_ID is not set');
    process.exit(1);
  }

  const members = await db
    .select({ email: users.email, name: users.name, createdAt: networkMembers.createdAt })
    .from(networkMembers)
    .innerJoin(users, eq(users.id, networkMembers.userId))
    .where(and(
      eq(networkMembers.networkId, indexEarlyNetworkId),
      isNull(networkMembers.deletedAt),
      isNull(users.deletedAt),
    ))
    .orderBy(networkMembers.createdAt);

  console.log(`${members.length} members to sync${confirm ? '' : ' (dry run — pass --confirm to write)'}`);
  if (!confirm) return;

  await ensureLoopsMemberProperties();

  let synced = 0;
  let failed = 0;
  for (const member of members) {
    const ok = await syncMemberToLoops(member);
    if (ok) synced++;
    else failed++;
    if ((synced + failed) % 50 === 0) console.log(`…${synced + failed}/${members.length}`);
    // Loops allows 10 requests/second; stay under it.
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  console.log(`✅ Done: ${synced} synced, ${failed} failed`);
}

main()
  .catch((error) => {
    console.error('❌ Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
