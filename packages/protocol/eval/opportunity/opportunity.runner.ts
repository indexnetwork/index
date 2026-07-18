import { executeRuns, type EvalEvidencePolicy, type EvalRunBatch } from "../shared/index.js";
import { OPPORTUNITY_EVAL_ATTEMPT_TIMEOUT_MS, OPPORTUNITY_EVAL_MAX_ATTEMPTS, OPPORTUNITY_EVAL_RETRY_DELAY_MS } from "./opportunity.constants.js";
import { hasInternalLabel, hasUuid } from "./opportunity.leakage.js";
import type { OpportunityCase, OpportunityRunDetail } from "./opportunity.types.js";

/** Minimal presenter surface the runner needs (real OpportunityPresenter satisfies this). */
export interface PresenterLike {
  present(input: {
    viewerContext: string;
    otherPartyContext: string;
    matchReasoning: string;
    category: string;
    confidence: number;
    signalsSummary: string;
    indexName: string;
    viewerRole: string;
    isIntroduction?: boolean;
    introducerName?: string;
  }, options?: { signal?: AbortSignal }): Promise<{
    headline: string;
    personalizedSummary: string;
    suggestedAction: string;
    greeting: string;
    isFallback?: boolean;
    fallbackReason?: "timeout" | "error" | "sanitization";
  }>;
}

export interface RunCaseOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  attemptTimeoutMs?: number;
  policy?: EvalEvidencePolicy;
  signal?: AbortSignal;
}

class OpportunityPresenterFallbackError extends Error {
  readonly code: string;

  constructor(reason: "timeout" | "error" | "sanitization" | "legacy-shape") {
    super(`opportunity presenter returned fallback output (${reason})`);
    this.name = "OpportunityPresenterFallbackError";
    this.code = `OPPORTUNITY_PRESENTER_FALLBACK_${reason.toUpperCase().replace("-", "_")}`;
  }
}

function fallbackReason(presentation: {
  headline: string;
  greeting: string;
  isFallback?: boolean;
  fallbackReason?: "timeout" | "error" | "sanitization";
}): "timeout" | "error" | "sanitization" | "legacy-shape" | null {
  if (presentation.isFallback) return presentation.fallbackReason ?? "error";
  return presentation.headline === "A promising connection" && presentation.greeting === ""
    ? "legacy-shape"
    : null;
}

async function invokeOnce(
  presenter: PresenterLike,
  c: OpportunityCase,
  signal: AbortSignal,
): Promise<OpportunityRunDetail> {
  const presentation = await presenter.present(c.input, { signal });
  const fallback = fallbackReason(presentation);
  if (fallback) throw new OpportunityPresenterFallbackError(fallback);
  const fields: Array<[string, string]> = [
    ["headline", presentation.headline],
    ["summary", presentation.personalizedSummary],
    ["suggestedAction", presentation.suggestedAction],
    ["greeting", presentation.greeting],
  ];
  const leaks: string[] = [];
  for (const [name, value] of fields) {
    if (hasUuid(value)) leaks.push(`UUID in ${name}`);
    if (hasInternalLabel(value)) leaks.push(`internal label in ${name}`);
  }
  return {
    headline: presentation.headline,
    personalizedSummary: presentation.personalizedSummary,
    suggestedAction: presentation.suggestedAction,
    greeting: presentation.greeting,
    leaks,
  };
}

/** Run every configured slot and retain all retry/failure evidence. */
export async function runCase(
  presenter: PresenterLike,
  c: OpportunityCase,
  runs: number,
  options: RunCaseOptions = {},
): Promise<EvalRunBatch<OpportunityRunDetail>> {
  return executeRuns(({ signal }) => invokeOnce(presenter, c, signal), runs, {
    caseId: c.id,
    maxAttempts: options.maxAttempts ?? OPPORTUNITY_EVAL_MAX_ATTEMPTS,
    retryDelayMs: options.retryDelayMs ?? OPPORTUNITY_EVAL_RETRY_DELAY_MS,
    attemptTimeoutMs: options.attemptTimeoutMs ?? OPPORTUNITY_EVAL_ATTEMPT_TIMEOUT_MS,
    policy: options.policy,
    signal: options.signal,
    label: "opportunity eval",
  });
}
