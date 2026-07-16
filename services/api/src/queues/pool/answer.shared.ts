/**
 * Pool-answer application (IND-419) — Tier 0 + Tier 1 + Beat-1 narration.
 *
 * On a pool_discovery answer:
 *   Tier 0 (<1s, deterministic): apply the stored assignment plan to the live
 *     pool — metadata.poolAdjustments patches (chosen 1.0, other 0.6 with a
 *     template detail from the user's own words, unassigned live members 0.9).
 *     Guarded by staleness: when >30% of the snapshot's opportunities left the
 *     pool, nothing is reshuffled.
 *   Beat 1: template assistant message into the intent's negotiator session
 *     (counts only — never LLM reasoning).
 *   Tier 1 (~15–60s): debounced from-intent re-discovery (one BullMQ
 *     deduplication key per intent so an answer burst coalesces); the run's
 *     completion re-mines via the shared hook (P2.1), staging the next
 *     question, and writes Beat 2.
 *
 * Ordering itself is read-side: feed.graph.ts multiplies confidence by the
 * stored factors when POOL_QUESTIONS_RANKING=on. The categorizer cache key
 * hashes the ORDERED id set, so a reorder is structurally a fresh cache key —
 * no explicit invalidation needed (verified IND-419 recon).
 */
import { POOL_RERUN_DEBOUNCE_MS, POOL_STALENESS_THRESHOLD, buildPoolAdjustment, planPoolAdjustments } from '@indexnetwork/protocol';
import type { PoolAdjustment, PoolAdjustmentSignal, QuestionPoolSnapshot } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { fromIntentQueue } from '../opportunity/from-intent.queue';

const logger = log.service.from('PoolAnswerApply');

/** Lifecycle admission for new work after applying an existing answer. */
export type PoolLifecycleAdmission = 'active' | 'paused' | 'unavailable';

/** Outcome of one answer application (drives the Beat-1 template). */
export type PoolAnswerOutcome =
  | { kind: 'none' }
  | { kind: 'stale'; staleRatio: number }
  | { kind: 'applied'; promoted: number; demoted: number; unknownAdjusted: number };

type LivePoolOpportunity = { id: string };

export interface PoolAdjustmentWrite {
  opportunityId: string;
  adjustment: PoolAdjustment;
  signal: PoolAdjustmentSignal;
}

export interface PoolAnswerApplyDeps {
  listLivePool: (userId: string, intentId: string) => Promise<LivePoolOpportunity[]>;
  /** One transaction that rechecks scope and returns only rows actually patched. */
  applyAdjustments: (
    recipientUserId: string,
    intentId: string,
    writes: PoolAdjustmentWrite[],
  ) => Promise<string[]>;
}

const defaultApplyDeps: PoolAnswerApplyDeps = {
  listLivePool: (userId, intentId) =>
    chatDatabaseAdapter.getLivePoolOpportunitiesForIntent(userId, intentId),
  applyAdjustments: (recipientUserId, intentId, writes) =>
    chatDatabaseAdapter.applyOpportunityPoolAdjustments(recipientUserId, intentId, writes),
};

/** Tier-0 apply: patch the live pool from the answered question's snapshot. */
export async function applyPoolAnswer(input: {
  userId: string;
  intentId: string;
  questionId: string;
  pool: QuestionPoolSnapshot;
  selectedOption: string;
}, deps: PoolAnswerApplyDeps = defaultApplyDeps): Promise<PoolAnswerOutcome> {
  const now = new Date().toISOString();
  const plan = planPoolAdjustments(
    input.pool.discriminator,
    input.selectedOption,
    input.questionId,
    input.userId,
    input.intentId,
    now,
  );
  if (plan.length === 0) return { kind: 'none' }; // "Both matter" — no preference recorded.

  const live = await deps.listLivePool(input.userId, input.intentId);
  const liveById = new Map(live.map((opportunity) => [opportunity.id, opportunity]));

  const assignments = input.pool.discriminator.assignments;
  const missing = assignments.filter((a) => !liveById.has(a.opportunityId)).length;
  const staleRatio = assignments.length > 0 ? missing / assignments.length : 1;
  if (staleRatio > POOL_STALENESS_THRESHOLD) {
    logger.info('Pool answer stale — skipping re-rank', {
      questionId: input.questionId,
      staleRatio: Math.round(staleRatio * 100) / 100,
    });
    return { kind: 'stale', staleRatio };
  }

  const patched = new Set<string>();
  const outcomeByOpportunityId = new Map<string, 'promoted' | 'demoted' | 'unknown'>();
  const chosenSide = plan.find((entry) => entry.adjustment.factor === 1)?.adjustment.side ?? input.selectedOption;
  const writes: PoolAdjustmentWrite[] = [];
  for (const entry of plan) {
    if (!liveById.has(entry.opportunityId)) continue; // Left the pool since mining — nothing to patch.
    const isChosen = entry.adjustment.factor === 1;
    writes.push({
      opportunityId: entry.opportunityId,
      adjustment: entry.adjustment,
      signal: entry.signal,
    });
    patched.add(entry.opportunityId);
    outcomeByOpportunityId.set(entry.opportunityId, isChosen ? 'promoted' : 'demoted');
  }

  // Live pool members the miner could not assign: mild uncertainty discount.
  const label = input.pool.discriminator.label;
  for (const row of live) {
    if (patched.has(row.id)) continue;
    const write = buildPoolAdjustment({
      questionId: input.questionId,
      recipientUserId: input.userId,
      intentId: input.intentId,
      label,
      assignedSide: null,
      chosenSide,
      appliedAt: now,
    });
    writes.push({ opportunityId: row.id, ...write });
    outcomeByOpportunityId.set(row.id, 'unknown');
  }

  const appliedIds = new Set(await deps.applyAdjustments(input.userId, input.intentId, writes));
  let promoted = 0;
  let demoted = 0;
  let unknownAdjusted = 0;
  for (const opportunityId of appliedIds) {
    switch (outcomeByOpportunityId.get(opportunityId)) {
      case 'promoted': promoted++; break;
      case 'demoted': demoted++; break;
      case 'unknown': unknownAdjusted++; break;
    }
  }

  logger.info('Pool answer applied', {
    questionId: input.questionId,
    intentId: input.intentId,
    promoted,
    demoted,
    unknownAdjusted,
  });
  return { kind: 'applied', promoted, demoted, unknownAdjusted };
}

/**
 * Beat-1 template (never LLM text; counts + the user's own choice only).
 *
 * @param outcome - Deterministic Tier-0 result.
 * @param rankingEnabled - Whether local pool ranking is visible.
 * @param admission - Lifecycle admission for Tier-1 discovery.
 * @returns User-facing deterministic narration.
 */
export function beatOneMessage(
  outcome: PoolAnswerOutcome,
  rankingEnabled = true,
  admission: PoolLifecycleAdmission = 'active',
): string {
  const willResearch = admission === 'active';
  if (admission === 'unavailable' && outcome.kind !== 'none') {
    return "Preference saved, but I couldn't start a fresh search right now.";
  }

  switch (outcome.kind) {
    case 'applied': {
      if (!rankingEnabled) {
        return willResearch
          ? 'Noted — I saved your preference. It will shape the fresh matches I am searching for now.'
          : "Noted — I saved your preference. This signal is paused, so I didn't start a new search.";
      }
      const parts = [`Applied your answer — ${outcome.promoted} match${outcome.promoted === 1 ? '' : 'es'} prioritized`];
      if (outcome.demoted > 0) parts.push(`${outcome.demoted} deprioritized`);
      return willResearch
        ? `${parts.join(', ')}. I'm also re-searching with this in mind — new matches land here in about a minute.`
        : `${parts.join(', ')}. This signal is paused, so I didn't start a new search.`;
    }
    case 'stale':
      return willResearch
        ? "Noted — your matches shifted since I mined that question, so I didn't reshuffle anything. Your answer will shape the new matches I'm about to find."
        : "Noted — your matches shifted since I mined that question, so I didn't reshuffle anything. This signal is paused, so I didn't start a new search.";
    case 'none':
      return "Got it — both sides matter, so I'm keeping your matches ranked as they are.";
  }
}

/** Beat-2 template, written by the from-intent completion for pool-answer runs. */
export function beatTwoMessage(newCandidates: number | null): string {
  if (newCandidates === null) return 'Searched again with your answer in mind — your matches are refreshed.';
  if (newCandidates === 0) return "Searched again with your answer in mind — no new people yet, but I'll keep looking.";
  return `Searched again with your answer in mind — found ${newCandidates} new ${newCandidates === 1 ? 'person' : 'people'}.`;
}

/** Tier-1 enqueue dependency (injectable for deterministic tests). */
export interface PoolRerunEnqueueDeps {
  addJob: typeof fromIntentQueue.addJob;
}

/**
 * BullMQ debounce mode (`replace` + `extend`) gives a real sliding window
 * across wall-clock boundaries. `keepLastIfActive` preserves one trailing run
 * when an answer arrives after the worker has already started, so no durable
 * preference is omitted by active-job deduplication.
 */
export async function enqueuePoolRerun(
  input: { userId: string; intentId: string },
  deps: PoolRerunEnqueueDeps = { addJob: fromIntentQueue.addJob.bind(fromIntentQueue) },
): Promise<void> {
  await deps.addJob(
    { intentId: input.intentId, userId: input.userId, trigger: 'pool_answer' },
    {
      delay: POOL_RERUN_DEBOUNCE_MS,
      removeOnComplete: true,
      removeOnFail: true,
      deduplication: {
        id: `pool-rerun-${input.intentId}`,
        ttl: POOL_RERUN_DEBOUNCE_MS,
        extend: true,
        replace: true,
        keepLastIfActive: true,
      },
    },
  );
}
