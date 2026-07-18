import { db, schema, sql } from './database.shared';

/** Drizzle transaction handle shared by negotiation-attempt atomic operations. */
export type NegotiationAttemptTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Stable advisory-lock namespace for one opportunity's negotiation attempts. */
export function negotiationAttemptLockName(opportunityId: string): string {
  return `negotiation-attempt:${opportunityId}`;
}

/**
 * Serialize task creation and fallback compensation for one opportunity.
 * The transaction-scoped lock is released automatically on commit/rollback.
 */
export async function acquireNegotiationAttemptLock(
  tx: NegotiationAttemptTransaction,
  opportunityId: string,
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${negotiationAttemptLockName(opportunityId)}, 0)
    )
  `);
}

/**
 * Qualifying tasks that prove an attempt is already owned or still active.
 * Historical stale non-input-required tasks deliberately do not qualify.
 */
export function qualifyingNegotiationAttemptTaskWhere(
  opportunityId: string,
  expectedUpdatedAt: Date,
) {
  return sql`
    ${schema.tasks.metadata}->>'type' = 'negotiation'
    AND ${schema.tasks.metadata}->>'opportunityId' = ${opportunityId}
    AND (
      ${schema.tasks.createdAt} >= ${expectedUpdatedAt.toISOString()}::timestamptz
      OR ${schema.tasks.state} = 'input_required'
      OR (
        ${schema.tasks.state} IN ('submitted', 'working', 'waiting_for_agent', 'claimed')
        AND ${schema.tasks.updatedAt} >= NOW() - INTERVAL '5 minutes'
      )
    )
  `;
}
