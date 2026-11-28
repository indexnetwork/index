#!/usr/bin/env bun
/**
 * Give contacts Introduce already looked up a photo: for every unclaimed seat
 * with no avatar, try their Gravatar and their GitHub avatar (research is not
 * run again) and store what is found. New seats get one when they are made.
 *
 * Reads only .env.development, so it can only touch the dev database and bucket.
 *
 * Usage: bun src/cli/introducer-seat-avatars.ts [--dry-run]
 */
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(import.meta.dir, '../../../..', '.env.development'), override: true });

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { sql } = await import('drizzle-orm');
  const { default: db, closeDb } = await import('../lib/drizzle/drizzle');
  const { findSeatAvatar } = await import('../lib/introducer/avatar');
  const { introducerDatabaseAdapter } = await import('../adapters/introducer.database.adapter');

  const result = await db.execute(sql`
    select g.id, r.email
    from contact_research r
    join users g on g.id = r.seat_user_id and g.deleted_at is null and g.email_verified = false
    where r.status = 'found' and g.avatar is null
  `);
  const seats = (result as unknown as { rows?: { id: string; email: string }[] }).rows ?? (result as unknown as { id: string; email: string }[]);
  console.log(`[seat-avatars] ${seats.length} seats without a photo${dryRun ? ' (dry run)' : ''}`);

  let found = 0;
  for (const seat of seats) {
    const socials = await introducerDatabaseAdapter.seatSocials(seat.id);
    if (dryRun) continue;
    const key = await findSeatAvatar(seat.id, { email: seat.email, socials });
    if (!key) continue;
    await introducerDatabaseAdapter.setSeatAvatar(seat.id, key);
    found += 1;
  }
  console.log(`[seat-avatars] stored ${found} of ${seats.length}`);
  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error('[seat-avatars] Fatal error:', err);
  process.exit(1);
});
