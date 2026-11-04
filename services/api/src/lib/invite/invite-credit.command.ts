import { and, eq, inArray, sql } from 'drizzle-orm';

import type db from '../drizzle/drizzle';
import { inviteCredits, users } from '../../schemas/database.schema';
import { decideCredit } from './invite-credit.policy';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Credit the direct inviter of each invitee in an accepted opportunity.
 * Runs inside the accepting transaction. Each invitee row is locked, so two
 * accepts racing for the same invitee cannot both pass the cap check.
 *
 * Safe to call on every accept: the ledger's unique key makes a repeat a no-op.
 *
 * @param tx - The open transaction that just projected the opportunity to `accepted`.
 * @param opportunityId - The accepted opportunity.
 * @param actorIds - The named humans on the opportunity.
 */
export async function recordInviteCredits(tx: Tx, opportunityId: string, actorIds: string[]): Promise<void> {
  if (actorIds.length < 2) return;

  const people = await tx.select({
    id: users.id,
    emailVerified: users.emailVerified,
    invitedById: users.invitedById,
  }).from(users).where(inArray(users.id, actorIds));

  for (const invitee of people) {
    if (!invitee.invitedById) continue;
    await tx.select({ id: users.id }).from(users).where(eq(users.id, invitee.id)).for('update');

    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
      .from(inviteCredits)
      .where(eq(inviteCredits.inviteeUserId, invitee.id));
    let creditCount = count;

    for (const counterpart of people) {
      if (counterpart.id === invitee.id) continue;
      const [existing] = await tx.select({ id: inviteCredits.id }).from(inviteCredits).where(and(
        eq(inviteCredits.inviteeUserId, invitee.id),
        eq(inviteCredits.counterpartUserId, counterpart.id),
      ));

      const decision = decideCredit({
        inviteeEmailVerified: invitee.emailVerified,
        inviteeInviterId: invitee.invitedById,
        counterpartId: counterpart.id,
        counterpartInviterId: counterpart.invitedById,
        alreadyCredited: Boolean(existing),
        inviteeCreditCount: creditCount,
      });
      if (!decision.credit) continue;

      const inserted = await tx.insert(inviteCredits).values({
        inviterUserId: decision.inviterId,
        inviteeUserId: invitee.id,
        counterpartUserId: counterpart.id,
        opportunityId,
      }).onConflictDoNothing().returning({ id: inviteCredits.id });
      if (inserted.length > 0) creditCount += 1;
    }
  }
}
