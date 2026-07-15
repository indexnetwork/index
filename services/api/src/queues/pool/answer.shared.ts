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
 *   Tier 1 (~15–60s): debounced from-intent re-discovery (one active BullMQ
 *     job id per intent so an answer burst coalesces into one run); the run's
 *     completion re-mines via the shared hook (P2.1), staging the next
 *     question, and writes Beat 2.
 *
 * Ordering itself is read-side: feed.graph.ts multiplies confidence by the
 * stored factors when POOL_QUESTIONS_RANKING=on. The categorizer cache key
 * hashes the ORDERED id set, so a reorder is structurally a fresh cache key —
 * no explicit invalidation needed (verified IND-419 recon).
 */
import { POOL_ADJUSTMENT_FACTOR_UNKNOWN, POOL_RERUN_DEBOUNCE_MS, POOL_STALENESS_THRESHOLD, planPoolAdjustments } from '@indexnetwork/protocol';
import type { PoolAdjustment, QuestionPoolSnapshot } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { fromIntentQueue } from '../opportunity/from-intent.queue';

const logger = log.service.from('PoolAnswerApply');

/** Statuses that make an opportunity part of the viewer's live candidate pool. */
const POOL_STATUSES = ['draft', 'latent', 'pending', 'negotiating'] as const;

/** Keep Tier 0 fast without exhausting the database pool on a 100-row pool. */
const ADJUSTMENT_WRITE_CONCURRENCY = 10;

/** Outcome of one answer application (drives the Beat-1 template). */
export type PoolAnswerOutcome =
  | { kind: 'none' }
  | { kind: 'stale'; staleRatio: number }
  | { kind: 'applied'; promoted: number; demoted: number; unknownAdjusted: number };

type LivePoolOpportunity = { id: string };

export interface PoolAnswerApplyDeps {
  listLivePool: (userId: string, intentId: string) => Promise<LivePoolOpportunity[]>;
  applyAdjustment: (
    opportunityId: string,
    adjustment: PoolAdjustment,
    signal: { type: 'pool_discriminator'; weight: number; detail: string; questionId: string },
  ) => Promise<void>;
}

const defaultApplyDeps: PoolAnswerApplyDeps = {
  listLivePool: (userId, intentId) => chatDatabaseAdapter.getOpportunitiesForUser(userId, {
    statuses: [...POOL_STATUSES],
    limit: 100,
    scopeType: 'intent',
    scopeId: intentId,
  }),
  applyAdjustment: (opportunityId, adjustment, signal) =>
    chatDatabaseAdapter.applyOpportunityPoolAdjustment(opportunityId, adjustment, signal),
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
  const plan = planPoolAdjustments(input.pool.discriminator, input.selectedOption, input.questionId, now);
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

  let promoted = 0;
  let demoted = 0;
  const patched = new Set<string>();
  const chosenSide = plan.find((entry) => entry.adjustment.factor === 1)?.adjustment.side ?? input.selectedOption;
  const writes: Array<() => Promise<void>> = [];
  for (const entry of plan) {
    if (!liveById.has(entry.opportunityId)) continue; // Left the pool since mining — nothing to patch.
    const isChosen = entry.adjustment.factor === 1;
    writes.push(() => deps.applyAdjustment(entry.opportunityId, entry.adjustment, {
      type: 'pool_discriminator',
      weight: isChosen ? 1 : -1,
      detail: `${entry.adjustment.label}: ${chosenSide}`,
      questionId: input.questionId,
    }));
    patched.add(entry.opportunityId);
    if (isChosen) promoted++;
    else demoted++;
  }

  // Live pool members the miner could not assign: mild uncertainty discount.
  let unknownAdjusted = 0;
  const label = input.pool.discriminator.label;
  for (const row of live) {
    if (patched.has(row.id)) continue;
    const adjustment: PoolAdjustment = {
      questionId: input.questionId,
      label,
      side: 'unknown',
      factor: POOL_ADJUSTMENT_FACTOR_UNKNOWN,
      appliedAt: now,
    };
    writes.push(() => deps.applyAdjustment(row.id, adjustment, {
      type: 'pool_discriminator',
      weight: 0,
      detail: `${label}: unassigned`,
      questionId: input.questionId,
    }));
    unknownAdjusted++;
  }

  for (let index = 0; index < writes.length; index += ADJUSTMENT_WRITE_CONCURRENCY) {
    await Promise.all(writes.slice(index, index + ADJUSTMENT_WRITE_CONCURRENCY).map((write) => write()));
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

/** Beat-1 template (never LLM text; counts + the user's own choice only). */
export function beatOneMessage(outcome: PoolAnswerOutcome, rankingEnabled = true): string {
  switch (outcome.kind) {
    case 'applied': {
      if (!rankingEnabled) {
        return 'Noted — I saved your preference. It will shape the fresh matches I am searching for now.';
      }
      const parts = [`Applied your answer — ${outcome.promoted} match${outcome.promoted === 1 ? '' : 'es'} prioritized`];
      if (outcome.demoted > 0) parts.push(`${outcome.demoted} deprioritized`);
      return `${parts.join(', ')}. I'm also re-searching with this in mind — new matches land here in about a minute.`;
    }
    case 'stale':
      return "Noted — your matches shifted since I mined that question, so I didn't reshuffle anything. Your answer will shape the new matches I'm about to find.";
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
 * Fixed per-intent job id gives a real sliding debounce: BullMQ ignores later
 * adds while the first job is delayed/active, including bursts that cross a
 * wall-clock minute boundary. Removal on settle frees the id for the next
 * answer after this run.
 */
export async function enqueuePoolRerun(
  input: { userId: string; intentId: string },
  deps: PoolRerunEnqueueDeps = { addJob: fromIntentQueue.addJob.bind(fromIntentQueue) },
): Promise<void> {
  await deps.addJob(
    { intentId: input.intentId, userId: input.userId, trigger: 'pool_answer' },
    {
      jobId: `pool-rerun-${input.intentId}`,
      delay: POOL_RERUN_DEBOUNCE_MS,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}
