/**
 * Shared pool-discriminator mining hook (IND-417/418, generalized in P2.1).
 *
 * One discovery pipeline finishes → mine discriminators over the viewer's
 * intent pool (shadow log) and, when POOL_QUESTIONS_MODE=on, enqueue a
 * pool_discovery question for the top eligible discriminator.
 *
 * Callers (fire-and-forget from every discovery completion path):
 *   - DiscoveryRunQueue   — async MCP discover_opportunities runs
 *   - FromIntentQueue     — web intent creation / edit / re-discovery
 *   - PoolVisitMiningQueue — debounced owner intent-page visits (IND-439;
 *     flag-gated re-mine of the existing pool, no discovery run)
 *
 * The pool is read from the opportunities table (durable output; the MCP
 * tool response flattens cards into message text, so no run result carries a
 * structured candidate array). These are also the exact rows P3 re-ranks, so
 * mining over them keeps the phases consistent.
 *
 * Flags: mining runs when POOL_QUESTIONS_MINING=shadow OR
 * POOL_QUESTIONS_MODE=on; question enqueue additionally requires MODE=on and
 * QUESTIONER_ENABLED (via questionerEnqueueIfEnabled). All off = no-op.
 */
import { POOL_DISCRIMINATOR_MAX_CANDIDATES, POOL_DISCRIMINATOR_MIN_POOL_SIZE, PoolDiscriminatorMiner, poolQuestionsMiningMode, poolQuestionsMode, runPoolDiscriminatorShadow, selectQuestionDiscriminators, toQuestionDiscriminator } from '@indexnetwork/protocol';
import type { DiscriminatorShadowResult, PoolCandidate } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import db from '../../lib/drizzle/drizzle';
import { OPENROUTER_EMBEDDING_DIMENSIONS, OPENROUTER_EMBEDDING_MODEL } from '../../lib/embedding/embedding.config';
import { buildFullIntentText, buildIntentSnippet, computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { embedderAdapter } from '../../adapters/embedder.adapter';
import { QuestionerAdapter } from '../../adapters/questioner.adapter';
import { questionerEnqueueIfEnabled } from '../questioner.queue';
import { buildPoolCandidateContexts } from './context.shared';
import { maybeRunNegotiationEvidenceShadow } from './negotiation-evidence.shadow';
import { resolvePoolAxisNoveltyReferences } from './novelty.shared';
import { POOL_QUESTION_FRESHNESS_THRESHOLD, extractSnapshotOpportunityIds, isPoolArtifactFresh, setJaccard } from './poolquestions.constants';

/** Greppable logger (IND-417): search deploy logs for "PoolDiscriminatorMiner". */
const logger = log.job.from('PoolDiscriminatorMiner');

/** Statuses that make an opportunity part of the viewer's live candidate pool. */
const POOL_STATUSES = ['draft', 'latent', 'pending', 'negotiating'] as const;

/** Lazily constructed so importing this module never requires OPENROUTER_API_KEY. */
let poolDiscriminatorMiner: PoolDiscriminatorMiner | null = null;

/** Durable question metadata reader used by every mining completion path. */
const poolMiningQuestionerAdapter = new QuestionerAdapter(db);

/** One discovery-completion event, normalized across trigger sources. */
export interface PoolMiningTrigger {
  /**
   * Which pipeline finished (log dimension). `intent_visit` is the debounced
   * visit-triggered re-mine path (IND-439) — no discovery ran; the existing
   * pool is re-mined so an expired question's intent can mint a fresh one.
   */
  source: 'discovery_run' | 'from_intent' | 'intent_visit';
  userId: string;
  /** Triggering intent — required for questions; optional for shadow-only ad-hoc pools. */
  intentId?: string;
  /** Discovery run id, when the source has one. */
  runId?: string;
  /** Chat session that scoped the discovery (includes that session's drafts in the pool). */
  sessionId?: string;
  /** True for introducer-flow discovery: candidates are matches for someone else — skip. */
  isIntroducerFlow?: boolean;
  /** Ad-hoc query fallback for intent text (shadow-only pools). */
  searchQuery?: string;
}

/** Splits free text into novelty-reference sentences (short fragments dropped). */
function toReferenceSentences(text: string): string[] {
  return text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

/**
 * Fire-and-forget entry point: never awaited by the caller's lifecycle and
 * never allowed to fail the discovery pipeline. Both flags off = no-op.
 */
export function maybeMinePoolDiscriminators(trigger: PoolMiningTrigger): void {
  void minePoolDiscriminatorsOnCompletion(trigger);
}

/**
 * Awaitable, failure-isolated mining completion used by pool-answer Tier 1.
 * Regular discovery callers retain the fire-and-forget wrapper above; the
 * answer path awaits this so Beat 2 cannot race ahead of the next question.
 */
export function isPoolMiningActivated(): boolean {
  return poolQuestionsMiningMode() === 'shadow' || poolQuestionsMode() === 'on';
}

/** Reject question admission only when durable resolved-axis comparison failed. */
export function shouldEnqueuePoolQuestionForResolvedHistory(
  shadow: Pick<DiscriminatorShadowResult, 'priorReferenceComparisonUnavailable'>,
): boolean {
  return shadow.priorReferenceComparisonUnavailable !== true;
}

export async function minePoolDiscriminatorsOnCompletion(trigger: PoolMiningTrigger): Promise<void> {
  // Lens C (IND-433) runs on its OWN flag, independent of the Lens A pool
  // flags below — fire-and-forget and fully failure-isolated so it neither
  // blocks nor perturbs the discriminator mining path.
  void maybeRunNegotiationEvidenceShadow(trigger).catch(() => {});

  if (!isPoolMiningActivated()) return;
  // Introducer flow: the discovered candidates are matches for someone else,
  // not the viewer's own pool — discriminator questions don't apply.
  if (trigger.isIntroducerFlow) return;
  try {
    await minePoolDiscriminators(trigger);
  } catch (err) {
    logger.warn('shadow mining pass failed', {
      source: trigger.source,
      runId: trigger.runId ?? null,
      userId: trigger.userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

type PoolSelectionDatabase = Pick<
  typeof chatDatabaseAdapter,
  'getLivePoolOpportunitiesForIntent' | 'getOpportunitiesForUser'
>;

type PoolMiningLifecycleAdapter = Pick<
  QuestionerAdapter,
  'reconcilePendingPoolQuestions' | 'getLatestPoolQuestionSnapshot'
>;

/** MODE-only completion reconciliation and durable re-mine cadence decision. */
export async function shouldMineCurrentPool(input: {
  userId: string;
  intentId: string;
  intentFingerprint: string;
  currentPoolIds: string[];
}, adapter: PoolMiningLifecycleAdapter = poolMiningQuestionerAdapter): Promise<boolean> {
  const voided = await adapter.reconcilePendingPoolQuestions(
    input.userId,
    input.intentId,
    input.intentFingerprint,
    input.currentPoolIds,
    isPoolArtifactFresh,
  );
  if (voided.length > 0) return true;
  const latest = await adapter.getLatestPoolQuestionSnapshot(input.userId, input.intentId);
  return !(
    latest?.intentFingerprint === input.intentFingerprint
    && setJaccard(extractSnapshotOpportunityIds(latest), input.currentPoolIds)
      >= POOL_QUESTION_FRESHNESS_THRESHOLD
  );
}

/** Select the mining pool using exact trigger provenance for owned intents. */
export async function selectPoolForMining(
  userId: string,
  intentId: string | undefined,
  sessionId: string | undefined,
  database: PoolSelectionDatabase = chatDatabaseAdapter,
) {
  // Intent pools must use the same exact-trigger selector as Tier-0 reads and
  // row-locked writes. Selected-intent Radar is intentionally broader for
  // historical display (`actors[].intent`) and must never shape a question.
  const selectedPool = intentId
    ? await database.getLivePoolOpportunitiesForIntent(userId, intentId)
    : await database.getOpportunitiesForUser(userId, {
        statuses: [...POOL_STATUSES],
        limit: 50,
        // Chat-scoped MCP discovery creates this session's candidates as drafts;
        // passing the session id includes them in the ad-hoc pool.
        ...(sessionId ? { conversationId: sessionId } : {}),
      });
  return selectedPool
    .filter((opportunity) => !sessionId
      || opportunity.context?.conversationId === sessionId)
    .slice(0, 50);
}

async function minePoolDiscriminators(trigger: PoolMiningTrigger): Promise<void> {
  const { userId, intentId } = trigger;
  const questionsEnabled = poolQuestionsMode() === 'on';
  const pool = await selectPoolForMining(userId, intentId, trigger.sessionId);

  // Material intent state must be loaded before any candidate-context,
  // embedding, or miner work so MODE lifecycle reconciliation is independent
  // of the shadow flag and cadence can return cheaply.
  let intentText = trigger.searchQuery ?? '';
  let intentFingerprint: string | undefined;
  if (intentId) {
    const intent = await chatDatabaseAdapter.getIntent(intentId);
    if (intent?.userId === userId) {
      intentText = buildFullIntentText(intent.payload, intent.summary);
      intentFingerprint = computeIntentFingerprint(intent.payload, intent.summary);
    }
  }

  const withCounterpart = pool
    .map((o) => ({
      opportunity: o,
      counterpartUserId: o.actors.find((a) => a.userId !== userId && a.role !== 'introducer')?.userId,
    }))
    .filter((x): x is typeof x & { counterpartUserId: string } => Boolean(x.counterpartUserId));

  const top = withCounterpart
    .sort((a, b) => (b.opportunity.interpretation?.confidence ?? 0) - (a.opportunity.interpretation?.confidence ?? 0))
    .slice(0, POOL_DISCRIMINATOR_MAX_CANDIDATES);
  const currentPoolIds = top.map((entry) => entry.opportunity.id);

  if (
    questionsEnabled
    && intentId
    && intentFingerprint
    && !await shouldMineCurrentPool({ userId, intentId, intentFingerprint, currentPoolIds })
  ) {
    logger.debug('pool mining skipped: durable pool snapshot is fresh', {
      source: trigger.source,
      runId: trigger.runId ?? null,
      intentId,
    });
    return;
  }

  if (withCounterpart.length < POOL_DISCRIMINATOR_MIN_POOL_SIZE) {
    logger.debug('shadow mining skipped: pool below k-anonymity floor', {
      source: trigger.source,
      runId: trigger.runId ?? null,
      poolSize: withCounterpart.length,
      minPoolSize: POOL_DISCRIMINATOR_MIN_POOL_SIZE,
    });
    return;
  }

  // Thin bounded public context is shared verbatim with newborn stamping so
  // mining-time and insert-time classifications cannot drift.
  const candidates: PoolCandidate[] = await buildPoolCandidateContexts(
    userId,
    top.map((entry) => ({ id: entry.opportunity.id, opportunity: entry.opportunity })),
    chatDatabaseAdapter,
  );

  // Novelty references: the owner's own intent sentences + active premises —
  // axes the user has effectively already answered should score ~0.
  let ownerPremises: string[] = [];
  try {
    ownerPremises = (await chatDatabaseAdapter.getPremisesForUser(userId, 'ACTIVE'))
      .slice(0, 12)
      .map((p) => p.assertion.text);
  } catch {
    // Novelty degrades gracefully without references.
  }
  let resolvedAxes: import('@indexnetwork/protocol').QuestionPoolDiscriminator[] = [];
  if (questionsEnabled && intentId && intentFingerprint) {
    try {
      resolvedAxes = await poolMiningQuestionerAdapter.listResolvedPoolAxes(userId, intentId);
    } catch {
      // Durable semantic references are fail-open enrichment for mining.
    }
  }
  const axisReferences = resolvePoolAxisNoveltyReferences(
    resolvedAxes,
    OPENROUTER_EMBEDDING_MODEL,
    OPENROUTER_EMBEDDING_DIMENSIONS,
  );
  const referenceTexts = [
    ...toReferenceSentences(intentText),
    ...ownerPremises,
  ];

  poolDiscriminatorMiner ??= new PoolDiscriminatorMiner();
  const shadow = await runPoolDiscriminatorShadow({
    intentText,
    candidates,
    referenceTexts,
    priorReferenceTexts: axisReferences.referenceTexts,
    priorReferenceEmbeddings: axisReferences.referenceEmbeddings,
    embeddingModel: OPENROUTER_EMBEDDING_MODEL,
    retainEmbeddings: questionsEnabled,
    miner: poolDiscriminatorMiner,
    embedder: embedderAdapter,
  });

  const round = (n: number): number => Math.round(n * 1000) / 1000;
  logger.info('shadow mining result', {
    source: trigger.source,
    runId: trigger.runId ?? null,
    userId,
    intentId: intentId ?? null,
    poolSize: shadow.poolSize,
    discriminators: shadow.discriminators.map((d) => ({
      label: d.label,
      questionSeed: d.questionSeed,
      sides: d.sides,
      voi: round(d.voi),
      entropy: round(d.entropy),
      coverage: round(d.coverage),
      novelty: round(d.novelty),
      evidenceRate: round(d.evidenceRate),
    })),
  });

  if (!shouldEnqueuePoolQuestionForResolvedHistory(shadow)) {
    logger.warn('pool question skipped: resolved-axis comparison unavailable', {
      source: trigger.source,
      runId: trigger.runId ?? null,
      userId,
      intentId,
    });
    return;
  }

  // IND-418: turn the top eligible discriminator into a pool_discovery
  // question. QUESTIONER_ENABLED gates via questionerEnqueueIfEnabled;
  // budget + dedup enforcement lives in the QuestionerQueue worker.
  if (!questionsEnabled || !intentId || !intentFingerprint) return;
  const enqueue = questionerEnqueueIfEnabled();
  if (!enqueue) return;
  const eligible = selectQuestionDiscriminators(shadow.discriminators);
  if (eligible.length === 0) {
    logger.debug('no discriminator cleared the question bar', {
      source: trigger.source,
      runId: trigger.runId ?? null,
      intentId,
    });
    return;
  }
  await enqueue({
    mode: 'pool_discovery',
    userId,
    sourceType: 'intent',
    sourceId: intentId,
    triggeredByIntentId: intentId,
    context: {
      intentId,
      intentText: buildIntentSnippet(intentText),
      intentFingerprint,
      poolSize: shadow.poolSize,
      opportunityIds: currentPoolIds,
      ...(trigger.runId ? { runId: trigger.runId } : {}),
      minedAt: new Date().toISOString(),
      discriminators: eligible.map(toQuestionDiscriminator),
    },
  });
  logger.info('pool question enqueued', {
    source: trigger.source,
    runId: trigger.runId ?? null,
    intentId,
    eligible: eligible.length,
  });
}
