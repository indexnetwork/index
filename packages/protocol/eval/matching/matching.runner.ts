import type { EvaluatorInput, EvaluatedOpportunityWithActors } from "../../src/opportunity/opportunity.evaluator.js";

import { repeatRuns } from "../shared/index.js";
import { MATCHING_EVAL_MAX_ATTEMPTS, MATCHING_EVAL_RETRY_DELAY_MS, MATCHING_MIN_SCORE } from "./matching.constants.js";
import type { MatchingCase } from "./matching.types.js";

/** Minimal evaluator surface the runner needs (real OpportunityEvaluator satisfies this). */
export interface EvaluatorLike {
  invokeEntityBundle(
    input: EvaluatorInput,
    options: { minScore?: number; returnAll?: boolean },
  ): Promise<EvaluatedOpportunityWithActors[]>;
}

export interface RunCaseOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

/**
 * Run a case `runs` times. Uses MATCHING_MIN_SCORE + returnAll so reject bands
 * and sub-threshold diagnostic scores are visible to the scorer rather than filtered out.
 * Transient live-model/API failures are retried (shared {@link repeatRuns}) so long
 * full-corpus runs are less brittle.
 *
 * @param evaluator - The opportunity evaluator under test.
 * @param c - The case whose `input` is evaluated each run.
 * @param runs - Number of repetitions.
 * @param options - Retry tuning (defaults from matching constants).
 * @returns One opportunity list per run.
 */
export async function runCase(
  evaluator: EvaluatorLike,
  c: MatchingCase,
  runs: number,
  options: RunCaseOptions = {},
): Promise<EvaluatedOpportunityWithActors[][]> {
  return repeatRuns(
    () => evaluator.invokeEntityBundle(c.input, { minScore: MATCHING_MIN_SCORE, returnAll: true }),
    runs,
    {
      maxAttempts: options.maxAttempts ?? MATCHING_EVAL_MAX_ATTEMPTS,
      retryDelayMs: options.retryDelayMs ?? MATCHING_EVAL_RETRY_DELAY_MS,
      label: "matching eval",
    },
  );
}
