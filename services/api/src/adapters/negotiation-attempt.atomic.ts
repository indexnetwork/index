import { db, schema, sql } from './database.shared';

/** Drizzle transaction handle shared by negotiation-attempt atomic operations. */
export type NegotiationAttemptTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Stable advisory-lock namespace for one opportunity's negotiation attempts. */
export function negotiationAttemptLockName(opportunityId: string): string {
  return `negotiation-attempt:${opportunityId}`;
}

/** Stable pair-global lock namespace preventing concurrent cross-trigger attempts. */
export function negotiationPairLockName(actorUserIds: string[]): string {
  return `negotiation-pair:${[...new Set(actorUserIds)].sort().join('|')}`;
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

/** Serialize negotiation claims for the same normalized participant pair. */
export async function acquireNegotiationPairLock(
  tx: NegotiationAttemptTransaction,
  actorUserIds: string[],
): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${negotiationPairLockName(actorUserIds)}, 0)
    )
  `);
}

const ACTIVE_NEGOTIATION_FRESH_MS = 5 * 60 * 1000;
const DEFAULT_ASK_USER_WINDOW_MS = 24 * 60 * 60 * 1000;
const ASK_USER_LOCK_SLACK_MS = 60 * 60 * 1000;

function askUserLockWindowMs(): number {
  const parsed = Number(process.env.NEGOTIATION_ASK_USER_WINDOW_MS);
  return (Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ASK_USER_WINDOW_MS)
    + ASK_USER_LOCK_SLACK_MS;
}

function qualifyingFreshNegotiationTaskStateWhere() {
  return sql`
    (
      (
        ${schema.tasks.state} IN ('submitted', 'working', 'waiting_for_agent', 'claimed')
        AND ${schema.tasks.updatedAt} >= NOW() - (${ACTIVE_NEGOTIATION_FRESH_MS} * INTERVAL '1 millisecond')
      )
      OR (
        ${schema.tasks.state} = 'input_required'
        AND ${schema.tasks.updatedAt} >= NOW() - (${askUserLockWindowMs()} * INTERVAL '1 millisecond')
      )
    )
  `;
}

/** Fresh active task for one opportunity, used by final reactivation checks. */
export function qualifyingActiveNegotiationTaskWhere(opportunityId: string) {
  return sql`
    ${schema.tasks.metadata}->>'type' = 'negotiation'
    AND ${schema.tasks.metadata}->>'opportunityId' = ${opportunityId}
    AND ${qualifyingFreshNegotiationTaskStateWhere()}
  `;
}

/** Pair-global tasks fresh enough to block a concurrent cross-trigger attempt. */
export function qualifyingPairNegotiationTaskWhere(
  actorUserIds: string[],
  excludeOpportunityId?: string,
) {
  const actorContainment = actorUserIds.map((userId) => sql`EXISTS (
    SELECT 1 FROM jsonb_array_elements(${schema.opportunities.actors}) elem
    WHERE elem->>'userId' = ${userId}
      AND elem->>'role' IS DISTINCT FROM 'introducer'
  )`);
  return sql`
    ${schema.tasks.metadata}->>'type' = 'negotiation'
    AND ${schema.tasks.metadata}->>'opportunityId' = ${schema.opportunities.id}
    ${excludeOpportunityId
      ? sql`AND ${schema.opportunities.id} <> ${excludeOpportunityId}`
      : sql``}
    AND ${schema.opportunities.status} = 'negotiating'
    AND ${sql.join(actorContainment, sql` AND `)}
    AND ${qualifyingFreshNegotiationTaskStateWhere()}
  `;
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
