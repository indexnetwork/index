import type { PremiseAnalyzerOutput } from "../../src/premise/premise.analyzer.js";
import type { PremiseDecomposerOutput } from "../../src/premise/premise.decomposer.js";

import { repeatRuns } from "../shared/index.js";
import { PREMISE_EVAL_MAX_ATTEMPTS, PREMISE_EVAL_RETRY_DELAY_MS } from "./premise.constants.js";
import type { PremiseCase, PremiseRunDetail } from "./premise.types.js";

/** Minimal decomposer surface the runner needs (real PremiseDecomposer satisfies this). */
export interface DecomposerLike {
  invoke(input: string): Promise<PremiseDecomposerOutput>;
}

/** Minimal analyzer surface the runner needs (real PremiseAnalyzer satisfies this). */
export interface AnalyzerLike {
  invoke(premiseText: string, profileContext?: string): Promise<PremiseAnalyzerOutput>;
}

export interface PremiseDeps {
  decomposer: DecomposerLike;
  analyzer: AnalyzerLike;
}

export interface RunCaseOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

/** Invoke the right agent for `c` once and normalize its output to a {@link PremiseRunDetail}. */
async function invokeOnce(deps: PremiseDeps, c: PremiseCase): Promise<PremiseRunDetail> {
  if (c.component === "decompose") {
    const out = await deps.decomposer.invoke(c.input);
    return { component: "decompose", reasoning: out.reasoning, premises: out.premises };
  }
  const out = await deps.analyzer.invoke(c.input, c.profileContext);
  return {
    component: "analyze",
    reasoning: out.reasoning,
    speechActType: out.speechActType,
    felicity: { authority: out.felicityAuthority, sincerity: out.felicitySincerity, clarity: out.felicityClarity },
    semanticEntropy: out.semanticEntropy,
  };
}

/**
 * Run a premise case `runs` times, retrying transient live-model failures.
 *
 * @param deps - The decomposer + analyzer under test.
 * @param c - The case to run.
 * @param runs - Number of repetitions.
 * @param options - Retry tuning (defaults from premise constants).
 * @returns One normalized detail per run.
 */
export async function runCase(
  deps: PremiseDeps,
  c: PremiseCase,
  runs: number,
  options: RunCaseOptions = {},
): Promise<PremiseRunDetail[]> {
  return repeatRuns(() => invokeOnce(deps, c), runs, {
    maxAttempts: options.maxAttempts ?? PREMISE_EVAL_MAX_ATTEMPTS,
    retryDelayMs: options.retryDelayMs ?? PREMISE_EVAL_RETRY_DELAY_MS,
    label: "premise eval",
  });
}
