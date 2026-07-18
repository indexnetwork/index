import type { EvaluatorInput, EvaluatedOpportunityWithActors } from "../../src/opportunity/opportunity.evaluator.js";

import { executeRuns, type EvalEvidencePolicy, type EvalRunBatch } from "../shared/index.js";
import { MATCHING_EVAL_ATTEMPT_TIMEOUT_MS, MATCHING_EVAL_MAX_ATTEMPTS, MATCHING_EVAL_RETRY_DELAY_MS, MATCHING_MIN_SCORE } from "./matching.constants.js";
import type { MatchingCase } from "./matching.types.js";

/** Minimal evaluator surface the runner needs (real OpportunityEvaluator satisfies this). */
export interface EvaluatorLike {
  invokeEntityBundle(
    input: EvaluatorInput,
    options: { minScore?: number; returnAll?: boolean; signal?: AbortSignal },
  ): Promise<EvaluatedOpportunityWithActors[]>;
}

export interface RunCaseOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  attemptTimeoutMs?: number;
  policy?: EvalEvidencePolicy;
  signal?: AbortSignal;
}

/** Run every configured slot and retain all retry/failure evidence. */
export async function runCase(
  evaluator: EvaluatorLike,
  c: MatchingCase,
  runs: number,
  options: RunCaseOptions = {},
): Promise<EvalRunBatch<EvaluatedOpportunityWithActors[]>> {
  return executeRuns(
    ({ signal }) => evaluator.invokeEntityBundle(c.input, { minScore: MATCHING_MIN_SCORE, returnAll: true, signal }),
    runs,
    {
      caseId: c.id,
      maxAttempts: options.maxAttempts ?? MATCHING_EVAL_MAX_ATTEMPTS,
      retryDelayMs: options.retryDelayMs ?? MATCHING_EVAL_RETRY_DELAY_MS,
      attemptTimeoutMs: options.attemptTimeoutMs ?? MATCHING_EVAL_ATTEMPT_TIMEOUT_MS,
      policy: options.policy,
      signal: options.signal,
      label: "matching eval",
    },
  );
}
