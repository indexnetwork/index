import { repeatRuns } from "../shared/index.js";
import { OPPORTUNITY_EVAL_MAX_ATTEMPTS, OPPORTUNITY_EVAL_RETRY_DELAY_MS } from "./opportunity.constants.js";
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
  }): Promise<{ headline: string; personalizedSummary: string; suggestedAction: string; greeting: string }>;
}

export interface RunCaseOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

/**
 * The presenter swallows LLM timeouts/failures and returns a fixed fallback card:
 * headline "A promising connection", the raw matchReasoning as the summary, and an
 * empty greeting (both the party and introducer fallback branches share this — only
 * the suggestedAction copy differs between them). That degraded path is a resilience
 * concern, not card quality, so detect it and let the runner retry past it so the
 * eval measures real model output. A genuine card always populates the greeting and
 * never reuses the fixed fallback headline, so this signature does not false-positive.
 */
function isFallbackCard(p: { headline: string; greeting: string }): boolean {
  return p.headline === "A promising connection" && p.greeting === "";
}

/** Invoke the presenter once and normalize its card output (collecting leakage findings). */
async function invokeOnce(presenter: PresenterLike, c: OpportunityCase): Promise<OpportunityRunDetail> {
  const p = await presenter.present(c.input);
  if (isFallbackCard(p)) {
    // Throwing lets the shared retry loop re-run past a transient timeout fallback.
    throw new Error("opportunity presenter returned its timeout fallback card");
  }
  const fields: [string, string][] = [
    ["headline", p.headline],
    ["summary", p.personalizedSummary],
    ["suggestedAction", p.suggestedAction],
    ["greeting", p.greeting],
  ];
  const leaks: string[] = [];
  for (const [name, value] of fields) {
    if (hasUuid(value)) leaks.push(`UUID in ${name}`);
    if (hasInternalLabel(value)) leaks.push(`internal label in ${name}`);
  }
  return {
    headline: p.headline,
    personalizedSummary: p.personalizedSummary,
    suggestedAction: p.suggestedAction,
    greeting: p.greeting,
    leaks,
  };
}

/**
 * Run an opportunity card case `runs` times, retrying transient live-model failures.
 *
 * @param presenter - The opportunity presenter under test.
 * @param c - The case to run.
 * @param runs - Number of repetitions.
 * @param options - Retry tuning (defaults from opportunity constants).
 * @returns One normalized card detail per run.
 */
export async function runCase(
  presenter: PresenterLike,
  c: OpportunityCase,
  runs: number,
  options: RunCaseOptions = {},
): Promise<OpportunityRunDetail[]> {
  return repeatRuns(() => invokeOnce(presenter, c), runs, {
    maxAttempts: options.maxAttempts ?? OPPORTUNITY_EVAL_MAX_ATTEMPTS,
    retryDelayMs: options.retryDelayMs ?? OPPORTUNITY_EVAL_RETRY_DELAY_MS,
    label: "opportunity eval",
  });
}
