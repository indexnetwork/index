/**
 * Lens B shadow mining hook (IND-434).
 *
 * Fired fire-and-forget after an explicit owner action is captured. Reads the
 * append-only feedback events for exactly one recipient + intent + fingerprint
 * scope, mines neutral trade-off hypotheses BLIND to outcome, joins the owner
 * labels, and emits ONLY aggregate telemetry under the greppable
 * "OutcomeQuestionMiner" logger for human review.
 *
 * Guarantees (shadow discipline):
 *   - Never throws into the owner-action path (all failures warn-only).
 *   - Never writes questions, ranking, intent, premise, memory, newborn stamps,
 *     or push — the only durable write in this pipeline is the feedback event
 *     itself (done by the recorder before this runs).
 *   - Never logs opportunity ids, actions, candidate text, hypothesis/question
 *     text, side labels, below-k counts, or dynamic error strings. Only fixed
 *     codes and threshold-safe aggregates (counts that already clear k, and
 *     rounded rates) are emitted.
 *   - Immediately before mining it RE-READS the scoping intent and fails closed
 *     unless the recipient still owns it, its lifecycle is active, and its
 *     fingerprint still matches the one captured at event time (IND-434 §4).
 */
import { OUTCOME_MAX_CANDIDATES, OUTCOME_MAX_PUBLIC_CONTEXT_CHARS, OUTCOME_MIN_INDEPENDENT_EXAMPLES, PoolDiscriminatorMiner, isOutcomeQuestionsActivated, runOutcomeShadow, type OutcomeExample } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import { buildFullIntentText, computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { getOutcomeEventsForScope } from '../../lib/opportunity/outcome-events.store';
import { computeOutcomeIdempotencyKey, computeOutcomeSnapshotHash, isOutcomeHash } from '../../lib/opportunity/outcome-feedback.identity';

/** Intent lifecycle states in which a scope is still eligible for mining. */
const ELIGIBLE_INTENT_STATUS = 'ACTIVE';

/** Greppable logger (IND-434): search deploy logs for "OutcomeQuestionMiner". */
const logger = log.job.from('OutcomeQuestionMiner');

/** Lazily constructed so importing this module never requires OPENROUTER_API_KEY. */
let outcomeMiner: PoolDiscriminatorMiner | null = null;
function getOutcomeMiner(): PoolDiscriminatorMiner {
  if (!outcomeMiner) outcomeMiner = new PoolDiscriminatorMiner();
  return outcomeMiner;
}

/** One shadow mining scope, keyed exactly as events are stored. */
export interface OutcomeMiningScope {
  recipientUserId: string;
  intentId: string;
  intentFingerprint: string;
}

/**
 * Redacted, threshold-safe telemetry shape (exported for tests). Deliberately
 * carries NO opportunity ids, actions, candidate text, hypothesis/question
 * text, or side labels — only positional indices, rounded rates, and counts
 * that already clear the k independent-support floor.
 */
export function toShadowTelemetry(result: Awaited<ReturnType<typeof runOutcomeShadow>>) {
  return {
    code: 'shadow_result' as const,
    poolSize: result.poolSize,
    eligibleCount: result.eligibleCount,
    hypotheses: result.hypotheses.map((h, index) => ({
      index,
      evidenceRate: Math.round(h.evidenceRate * 1000) / 1000,
      minIndependentSupport: h.minIndependentSupport,
      sides: h.sides.map((s) => ({
        independentSupport: s.independentSupport,
        acceptRate: s.acceptRate,
      })),
    })),
  };
}

/** Scoping intent as re-read at mining time (lifecycle + ownership + fingerprint). */
export interface MiningIntent {
  payload: string;
  summary: string | null;
  userId: string;
  archivedAt: Date | null;
  status: string | null;
}

/** Injectable collaborators (defaults wire the real adapters) for hermetic tests. */
export interface OutcomeMiningDeps {
  getEvents: typeof getOutcomeEventsForScope;
  getIntent: (intentId: string) => Promise<MiningIntent | null>;
  miner: Pick<PoolDiscriminatorMiner, 'mine'>;
}

function defaultDeps(): OutcomeMiningDeps {
  return {
    getEvents: getOutcomeEventsForScope,
    getIntent: (intentId) => chatDatabaseAdapter.getIntent(intentId),
    miner: getOutcomeMiner(),
  };
}

/**
 * Fire-and-forget entry point. Swallows the promise so the caller's lifecycle
 * never awaits (or is failed by) the shadow pass.
 */
export function maybeMineOutcomeHypotheses(scope: OutcomeMiningScope): void {
  void mineOutcomeHypotheses(scope);
}

/**
 * Awaitable core (exported for tests). Returns without side effects when the
 * flag is off or the scope is below the k-anonymity floor.
 */
export async function mineOutcomeHypotheses(
  scope: OutcomeMiningScope,
  deps: OutcomeMiningDeps = defaultDeps(),
): Promise<void> {
  if (!isOutcomeQuestionsActivated()) return;

  try {
    const events = await deps.getEvents(
      scope.recipientUserId,
      scope.intentId,
      scope.intentFingerprint,
    );

    const examples: OutcomeExample[] = events.flatMap((event) => {
      if (event.action !== 'accepted' && event.action !== 'rejected') return [];
      // Treat injected/malformed rows as inert. Only exact-scope events with a
      // bounded, content-hashed presentation snapshot and canonical hashes may
      // reach the blind miner.
      if (
        event.recipientUserId !== scope.recipientUserId
        || event.intentId !== scope.intentId
        || event.intentFingerprint !== scope.intentFingerprint
        || !event.opportunityId.trim()
        || !isOutcomeHash(event.dedupKey)
        || !isOutcomeHash(event.snapshotHash)
        || !isOutcomeHash(event.idempotencyKey)
      ) return [];
      const candidateSnapshot = event.candidateSnapshot.trim();
      if (
        !candidateSnapshot
        || candidateSnapshot !== event.candidateSnapshot
        || candidateSnapshot.length > OUTCOME_MAX_PUBLIC_CONTEXT_CHARS
        || computeOutcomeSnapshotHash(candidateSnapshot) !== event.snapshotHash
        || computeOutcomeIdempotencyKey({
          recipientUserId: event.recipientUserId,
          intentId: event.intentId,
          intentFingerprint: event.intentFingerprint,
          opportunityId: event.opportunityId,
          action: event.action,
        }) !== event.idempotencyKey
      ) return [];
      return [{
        opportunityId: event.opportunityId,
        publicContext: candidateSnapshot,
        label: event.action,
        dedupKey: event.dedupKey,
        occurredAt: event.createdAt.toISOString(),
      }];
    });

    // Distinct independent examples (after related-opportunity dedup) below the
    // aggregate floor can never produce an eligible hypothesis. Skip the LLM.
    // (The exact below-k count is deliberately NOT logged.)
    const distinctKeys = new Set(examples.map((e) => e.dedupKey)).size;
    if (distinctKeys < OUTCOME_MIN_INDEPENDENT_EXAMPLES) {
      logger.debug('outcome mining skipped', { code: 'below_independent_floor' });
      return;
    }

    // Revalidate the scope immediately before mining (IND-434 §4): fail closed on
    // a missing intent, ownership mismatch, non-active/archived lifecycle, or a
    // fingerprint that no longer matches the one captured at event time (edit).
    const intent = await deps.getIntent(scope.intentId);
    if (!intent) {
      logger.debug('outcome mining skipped', { code: 'intent_unresolvable' });
      return;
    }
    if (intent.userId !== scope.recipientUserId) {
      logger.debug('outcome mining skipped', { code: 'ownership_mismatch' });
      return;
    }
    // Null is the legacy representation of ACTIVE in this codebase.
    if (intent.archivedAt !== null || (intent.status !== null && intent.status !== ELIGIBLE_INTENT_STATUS)) {
      logger.debug('outcome mining skipped', { code: 'lifecycle_ineligible' });
      return;
    }
    if (computeIntentFingerprint(intent.payload, intent.summary) !== scope.intentFingerprint) {
      logger.debug('outcome mining skipped', { code: 'fingerprint_drift' });
      return;
    }
    const intentText = buildFullIntentText(intent.payload, intent.summary);

    const result = await runOutcomeShadow({
      intentText,
      examples,
      miner: deps.miner,
      maxCandidates: OUTCOME_MAX_CANDIDATES,
    });

    // Aggregate telemetry ONLY (see toShadowTelemetry): no opportunity ids,
    // actions, candidate text, hypothesis/question text, side labels, below-k
    // counts, or dynamic error strings.
    logger.info('outcome shadow result', toShadowTelemetry(result));
  } catch {
    // Fixed code only — no dynamic message or error class text.
    logger.warn('outcome shadow mining pass failed', { code: 'mining_failed' });
  }
}
