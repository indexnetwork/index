/**
 * Lens B shadow orchestrator (IND-434): deduplicate related opportunities,
 * mine neutral axes over the deduplicated historical pool BLIND to outcome,
 * then join the owner-outcome labels and threshold the result.
 *
 * No persistence, no questions, no UI. The output is consumed only by aggregate
 * telemetry for human review.
 *
 * Pipeline:
 *   1. Dedup related opportunities: collapse examples sharing a dedup key to a
 *      single representative (most recent), so a cluster of related opps can
 *      neither dominate the miner nor inflate a side's independent support.
 *   2. Cap to the most recent OUTCOME_MAX_CANDIDATES for a bounded LLM pass.
 *   3. Build the miner pool — PoolCandidate carries id + publicContext + score
 *      and, critically, NO outcome label. The miner is structurally blind.
 *   4. Mine neutral axes + assign candidates (evidence-verified).
 *   5. Join outcome labels (only now) and apply the k-support threshold.
 */

import { protocolLogger } from "../../shared/observability/protocol.logger.js";
import type { PoolDiscriminatorMiner } from "../discriminator/discriminator.miner.js";
import type { PoolCandidate } from "../discriminator/discriminator.types.js";
import { OUTCOME_MAX_CANDIDATES, OUTCOME_MIN_COMPARED_SIDES, OUTCOME_MIN_INDEPENDENT_SUPPORT } from "./outcome.env.js";
import { joinOutcomeHypotheses } from "./outcome.hypotheses.js";
import type { OutcomeExample, OutcomeLabel, OutcomeShadowResult } from "./outcome.types.js";

const logger = protocolLogger("OutcomeQuestionShadow");

/** Input for one Lens B shadow mining+join pass. */
export interface OutcomeShadowInput {
  /**
   * Intent payload (+ summary) text that owns this scope. Used only as miner
   * context; never mixed with outcome labels.
   */
  intentText: string;
  /**
   * Captured owner-outcome examples for exactly one recipient + intent +
   * fingerprint scope. Each carries a presentation-safe snapshot and a dedup
   * key; outcome labels live here but are withheld from the miner.
   */
  examples: OutcomeExample[];
  miner: Pick<PoolDiscriminatorMiner, "mine">;
  /** Override the independent-support threshold (defaults to k). */
  minIndependentSupport?: number;
  /** Override the minimum qualified sides. */
  minComparedSides?: number;
  /** Override the LLM candidate cap. */
  maxCandidates?: number;
  signal?: AbortSignal;
}

/**
 * Collapse related opportunities to independent examples: one representative
 * (most recent by occurredAt) per distinct dedup key. Deterministic — ties on
 * occurredAt fall back to opportunityId ordering.
 */
export function deduplicateOutcomeExamples(examples: OutcomeExample[]): OutcomeExample[] {
  const byKey = new Map<string, OutcomeExample>();
  for (const example of examples) {
    const existing = byKey.get(example.dedupKey);
    if (existing === undefined) {
      byKey.set(example.dedupKey, example);
      continue;
    }
    const newer =
      example.occurredAt > existing.occurredAt ||
      (example.occurredAt === existing.occurredAt && example.opportunityId > existing.opportunityId);
    if (newer) byKey.set(example.dedupKey, example);
  }
  return [...byKey.values()].sort(
    (a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.opportunityId.localeCompare(b.opportunityId),
  );
}

/**
 * Run the Lens B shadow pipeline for one scope.
 *
 * Throws only when *mining* fails (callers are fire-and-forget and must catch).
 * A pool that is empty or below the compare floor after dedup returns an empty
 * result rather than throwing.
 */
export async function runOutcomeShadow(input: OutcomeShadowInput): Promise<OutcomeShadowResult> {
  const minSupport = input.minIndependentSupport ?? OUTCOME_MIN_INDEPENDENT_SUPPORT;
  const minSides = input.minComparedSides ?? OUTCOME_MIN_COMPARED_SIDES;
  const maxCandidates = input.maxCandidates ?? OUTCOME_MAX_CANDIDATES;

  // 1–2. Dedup related opportunities, then cap to a bounded, recent pool.
  const independent = deduplicateOutcomeExamples(input.examples).slice(0, maxCandidates);
  if (independent.length < minSupport * minSides) {
    return { poolSize: independent.length, eligibleCount: 0, hypotheses: [] };
  }

  // 3. Build the miner pool with RUN-LOCAL aliases (c0, c1, …) as candidate ids
  //    — raw opportunity ids are never sent to the LLM. The alias→outcome map is
  //    kept internally for the join. PoolCandidate deliberately excludes the
  //    outcome label, so the miner cannot condition on which side was chosen.
  const aliased = independent.map((example, index) => ({ alias: `c${index}`, example }));
  const candidates: PoolCandidate[] = aliased.map(({ alias, example }) => ({
    id: alias,
    publicContext: example.publicContext,
    score: example.score ?? 1,
  }));

  // 4. Blind assignment (assignments come back keyed by the run-local alias).
  const mined = await input.miner.mine(
    { intentText: input.intentText, candidates },
    input.signal ? { signal: input.signal } : undefined,
  );
  if (mined.length === 0) {
    return { poolSize: independent.length, eligibleCount: 0, hypotheses: [] };
  }

  // 5. Join outcome labels (only now) by alias, and threshold.
  const examples = new Map<string, OutcomeLabel>(
    aliased.map(({ alias, example }) => [alias, example.label]),
  );
  const result = joinOutcomeHypotheses({
    discriminators: mined,
    examples,
    minIndependentSupport: minSupport,
    minComparedSides: minSides,
  });

  logger.debug("shadow join complete", {
    poolSize: result.poolSize,
    eligibleCount: result.eligibleCount,
  });

  return result;
}
