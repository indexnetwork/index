import type { EvaluatorInput, EvaluatedOpportunityWithActors } from "../../src/opportunity/opportunity.evaluator.js";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function invokeWithRetry(
  evaluator: EvaluatorLike,
  input: EvaluatorInput,
  options: Required<RunCaseOptions>,
): Promise<EvaluatedOpportunityWithActors[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await evaluator.invokeEntityBundle(input, { minScore: MATCHING_MIN_SCORE, returnAll: true });
    } catch (err) {
      lastError = err;
      if (attempt >= options.maxAttempts) break;
      const delay = options.retryDelayMs * 2 ** (attempt - 1);
      console.warn(
        `[matching eval] evaluator call failed (attempt ${attempt}/${options.maxAttempts}); retrying in ${delay}ms: ${describeError(err)}`,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Run a case `runs` times. Uses MATCHING_MIN_SCORE + returnAll so reject bands
 * and sub-threshold diagnostic scores are visible to the scorer rather than filtered out.
 * Retries transient live-model/API failures so long full-corpus runs are less brittle.
 */
export async function runCase(
  evaluator: EvaluatorLike,
  c: MatchingCase,
  runs: number,
  options: RunCaseOptions = {},
): Promise<EvaluatedOpportunityWithActors[][]> {
  const retryOptions: Required<RunCaseOptions> = {
    maxAttempts: options.maxAttempts ?? MATCHING_EVAL_MAX_ATTEMPTS,
    retryDelayMs: options.retryDelayMs ?? MATCHING_EVAL_RETRY_DELAY_MS,
  };
  const outputs: EvaluatedOpportunityWithActors[][] = [];
  for (let i = 0; i < runs; i++) {
    outputs.push(await invokeWithRetry(evaluator, c.input, retryOptions));
  }
  return outputs;
}
