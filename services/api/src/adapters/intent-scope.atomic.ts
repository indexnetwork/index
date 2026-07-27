import { sql } from 'drizzle-orm/sql';

import type { DrizzleDB } from '../lib/drizzle/drizzle';

type DrizzleTx = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];

/** Canonical advisory-lock key for one recipient-owned intent mutation scope. */
export function intentScopeAdvisoryLockKey(userId: string, intentId: string): string {
  return `${userId}:${intentId}`;
}

/**
 * Serialize recovery persistence, exact-trigger opportunity creation, recovery
 * answers, pool lifecycle writes, and material intent reconciliation.
 */
export async function acquireIntentScopeAdvisoryLock(
  tx: DrizzleTx,
  userId: string,
  intentId: string,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${intentScopeAdvisoryLockKey(userId, intentId)}, 0)
    )
  `);
}
