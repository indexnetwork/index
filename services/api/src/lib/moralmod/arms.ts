/**
 * The study-arm mirror. The lab control plane pushes assignments; the hook
 * reads them through a short cache so a turn never waits on the cp.
 */

import { eq, inArray } from 'drizzle-orm';
import type { Arm } from '@indexnetwork/moralmod';

import db from '../drizzle/drizzle';
import { moralmodArms, users } from '../../schemas/database.schema';

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { arm: Arm | null; until: number }>();

export interface ArmAssignment {
  userId: string;
  arm: Arm;
  experimentId: string;
}

/** @param userId - A resident. @returns Their arm, or null outside the study. Cached for a minute. */
export async function armFor(userId: string): Promise<Arm | null> {
  const cached = cache.get(userId);
  if (cached && cached.until > Date.now()) return cached.arm;
  const [row] = await db.select({ arm: moralmodArms.arm }).from(moralmodArms).where(eq(moralmodArms.userId, userId)).limit(1);
  const arm = (row?.arm as Arm | undefined) ?? null;
  cache.set(userId, { arm, until: Date.now() + CACHE_TTL_MS });
  return arm;
}

/**
 * @param assignments - The cp's current truth for these residents.
 * @returns How many rows were written, and the user ids that do not exist here
 *   (departed or never provisioned) so the cp can reconcile instead of
 *   resending them forever. All-or-nothing: one transaction.
 */
export async function upsertArms(assignments: ArmAssignment[]): Promise<{ updated: number; unknownUserIds: string[] }> {
  if (!assignments.length) return { updated: 0, unknownUserIds: [] };
  const ids = [...new Set(assignments.map((assignment) => assignment.userId))];
  const result = await db.transaction(async (tx) => {
    const existing = new Set((await tx.select({ id: users.id }).from(users).where(inArray(users.id, ids))).map((row) => row.id));
    const known = assignments.filter((assignment) => existing.has(assignment.userId));
    for (const assignment of known) {
      await tx.insert(moralmodArms)
        .values({ userId: assignment.userId, arm: assignment.arm, experimentId: assignment.experimentId, updatedAt: new Date() })
        .onConflictDoUpdate({ target: moralmodArms.userId, set: { arm: assignment.arm, experimentId: assignment.experimentId, updatedAt: new Date() } });
    }
    return { updated: known.length, unknownUserIds: ids.filter((id) => !existing.has(id)) };
  });
  for (const assignment of assignments) cache.delete(assignment.userId);
  return result;
}

/** @param experimentId - The study. @returns Enrolled user ids, any arm. */
export async function enrolledUserIds(experimentId: string): Promise<string[]> {
  const rows = await db.select({ userId: moralmodArms.userId }).from(moralmodArms).where(eq(moralmodArms.experimentId, experimentId));
  return rows.map((row) => row.userId);
}

/** Drop cached arms (tests). */
export function resetArmCache(userIds?: string[]): void {
  if (!userIds) { cache.clear(); return; }
  for (const id of userIds) cache.delete(id);
}

/** @param userIds - Residents. @returns Their rows, for export scoping. */
export async function armsFor(userIds: string[]): Promise<Map<string, { arm: Arm; experimentId: string }>> {
  if (!userIds.length) return new Map();
  const rows = await db.select().from(moralmodArms).where(inArray(moralmodArms.userId, userIds));
  return new Map(rows.map((row) => [row.userId, { arm: row.arm as Arm, experimentId: row.experimentId }]));
}
