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

function qualifyingFreshNegotiationTaskStateWhere() {
  return sql`${schema.tasks.state} IN ('submitted', 'working', 'paused')`;
}

/** Fresh active task for one opportunity, used by final reactivation checks. */
export function qualifyingActiveNegotiationTaskWhere(opportunityId: string) {
  return sql`
    ${schema.tasks.metadata}->>'type' = 'negotiation'
    AND ${schema.tasks.metadata}->>'opportunityId' = ${opportunityId}
    AND ${qualifyingFreshNegotiationTaskStateWhere()}
  `;
}

/**
 * Reusable SQL predicate that excludes archived legacy pre-v2 negotiations.
 * Archived tasks carry `metadata->>'archivedAt'` stamped by the backfill.
 * Apply this to every user-visible SET-reader query.
 */
export function notArchivedNegotiationTaskWhere() {
  return sql`${schema.tasks.metadata}->>'archivedAt' IS NULL`;
}

/**
 * Reusable SQL predicate that keeps only rewrite-era negotiation tasks.
 * Every task the negotiation graph opens records `metadata.seats` (one
 * binding per seat: its signal and that signal's kickoff round); pre-rewrite
 * rows have no such key. Anything the working|paused|completed lifecycle acts
 * on must carry it, so a legacy row can never be swept, resumed, or acted on
 * while staying invisible to the round-scoped active count.
 */
export function rewriteEraNegotiationTaskWhere() {
  return sql`${schema.tasks.metadata} ? 'seats'`;
}

/**
 * Qualifying tasks that prove an attempt is already owned or still active.
 * Archived tasks (metadata->>'archivedAt' IS NOT NULL) are excluded.
 */
export function qualifyingNegotiationAttemptTaskWhere(
  opportunityId: string,
  expectedUpdatedAt: Date,
) {
  return sql`
    ${schema.tasks.metadata}->>'type' = 'negotiation'
    AND ${schema.tasks.metadata}->>'opportunityId' = ${opportunityId}
    AND ${notArchivedNegotiationTaskWhere()}
    AND (
      ${schema.tasks.createdAt} >= ${expectedUpdatedAt.toISOString()}::timestamptz
      OR ${schema.tasks.state} IN ('submitted', 'working', 'paused')
    )
  `;
}
