import type { PremiseAnalyzerOutput } from "../../src/premise/premise.analyzer.js";
import type { PremiseDecomposerOutput } from "../../src/premise/premise.decomposer.js";

import { executeRuns, type EvalEvidencePolicy, type EvalRunBatch } from "../shared/index.js";
import { PREMISE_EVAL_ATTEMPT_TIMEOUT_MS, PREMISE_EVAL_MAX_ATTEMPTS, PREMISE_EVAL_RETRY_DELAY_MS } from "./premise.constants.js";
import type { PremiseCase, PremiseRunDetail } from "./premise.types.js";

export interface DecomposerLike {
  invoke(
    input: string,
    existingPremises?: undefined,
    currentBio?: undefined,
    options?: { signal?: AbortSignal },
  ): Promise<PremiseDecomposerOutput>;
}

export interface AnalyzerLike {
  invoke(
    premiseText: string,
    profileContext?: string,
    options?: { signal?: AbortSignal },
  ): Promise<PremiseAnalyzerOutput>;
}

export interface PremiseDeps {
  decomposer: DecomposerLike;
  analyzer: AnalyzerLike;
}

export interface RunCaseOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  attemptTimeoutMs?: number;
  policy?: EvalEvidencePolicy;
  signal?: AbortSignal;
}

async function invokeOnce(deps: PremiseDeps, c: PremiseCase, signal: AbortSignal): Promise<PremiseRunDetail> {
  if (c.component === "decompose") {
    const out = await deps.decomposer.invoke(c.input, undefined, undefined, { signal });
    return { component: "decompose", reasoning: out.reasoning, premises: out.premises };
  }
  const out = await deps.analyzer.invoke(c.input, c.profileContext, { signal });
  return {
    component: "analyze",
    reasoning: out.reasoning,
    speechActType: out.speechActType,
    felicity: { authority: out.felicityAuthority, sincerity: out.felicitySincerity, clarity: out.felicityClarity },
    semanticEntropy: out.semanticEntropy,
  };
}

/** Run every configured slot and retain all retry/failure evidence. */
export async function runCase(
  deps: PremiseDeps,
  c: PremiseCase,
  runs: number,
  options: RunCaseOptions = {},
): Promise<EvalRunBatch<PremiseRunDetail>> {
  return executeRuns(({ signal }) => invokeOnce(deps, c, signal), runs, {
    caseId: c.id,
    maxAttempts: options.maxAttempts ?? PREMISE_EVAL_MAX_ATTEMPTS,
    retryDelayMs: options.retryDelayMs ?? PREMISE_EVAL_RETRY_DELAY_MS,
    attemptTimeoutMs: options.attemptTimeoutMs ?? PREMISE_EVAL_ATTEMPT_TIMEOUT_MS,
    policy: options.policy,
    signal: options.signal,
    label: "premise eval",
  });
}
