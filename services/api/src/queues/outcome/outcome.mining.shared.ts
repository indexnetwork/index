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
 *   - Never logs opportunity ids, candidate text, or small-cell counts. Every
 *     emitted side already clears the k independent-support floor, and only
 *     rounded accept RATES (not raw counts) are logged.
 */
import { OUTCOME_MAX_CANDIDATES, OUTCOME_MIN_INDEPENDENT_EXAMPLES, PoolDiscriminatorMiner, isOutcomeQuestionsActivated, runOutcomeShadow, type OutcomeExample } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import { buildFullIntentText } from '../../lib/intent/intent.fingerprint';
import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { getOutcomeEventsForScope } from '../../lib/opportunity/outcome-events.store';

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

/** Injectable collaborators (defaults wire the real adapters) for hermetic tests. */
export interface OutcomeMiningDeps {
  getEvents: typeof getOutcomeEventsForScope;
  getIntent: (intentId: string) => Promise<{ payload: string; summary: string | null } | null>;
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
      return [{
        opportunityId: event.opportunityId,
        publicContext: event.candidateSnapshot,
        label: event.action,
        dedupKey: event.dedupKey,
        occurredAt: event.createdAt.toISOString(),
      }];
    });

    // Distinct independent examples (after related-opportunity dedup) below the
    // aggregate floor can never produce an eligible hypothesis. Skip the LLM.
    const distinctKeys = new Set(examples.map((e) => e.dedupKey)).size;
    if (distinctKeys < OUTCOME_MIN_INDEPENDENT_EXAMPLES) {
      logger.debug('outcome mining skipped: below independent-example floor', {
        source: scope.recipientUserId ? 'owner_action' : 'unknown',
        distinctIndependentExamples: distinctKeys,
        floor: OUTCOME_MIN_INDEPENDENT_EXAMPLES,
      });
      return;
    }

    const intent = await deps.getIntent(scope.intentId);
    if (!intent) {
      logger.debug('outcome mining skipped: intent no longer resolvable');
      return;
    }
    const intentText = buildFullIntentText(intent.payload, intent.summary);

    const result = await runOutcomeShadow({
      intentText,
      examples,
      miner: deps.miner,
      maxCandidates: OUTCOME_MAX_CANDIDATES,
    });

    // Aggregate telemetry only: neutral labels, support sizes (>= k), and
    // rounded accept RATES. No opportunity ids, no candidate text, no cells < k.
    logger.info('outcome shadow result', {
      poolSize: result.poolSize,
      eligibleCount: result.eligibleCount,
      hypotheses: result.hypotheses.map((h) => ({
        label: h.label,
        questionSeed: h.questionSeed,
        evidenceRate: Math.round(h.evidenceRate * 1000) / 1000,
        minIndependentSupport: h.minIndependentSupport,
        sides: h.sides.map((s) => ({
          side: s.side,
          independentSupport: s.independentSupport,
          acceptRate: s.acceptRate,
        })),
      })),
    });
  } catch (error) {
    logger.warn('outcome shadow mining pass failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
