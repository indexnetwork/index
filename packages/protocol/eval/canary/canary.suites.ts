/**
 * Canary suite registry: the static, provider-free description of each
 * baseline-backed suite the canary can schedule (IND-447).
 *
 * Importing this module pulls in only committed corpus data and constants —
 * never an evaluator, model client, or credential. The registry is what lets
 * the plan/dry-run mode validate the manifest and compute budgets without any
 * provider access.
 */
import type { ModelAgent } from "../../src/shared/agent/model.config.js";
import { CASES as MATCHING_CASES } from "../matching/matching.cases.js";
import { MATCHING_EVAL_ATTEMPT_TIMEOUT_MS } from "../matching/matching.constants.js";
import { CASES as OPPORTUNITY_CASES } from "../opportunity/opportunity.cases.js";
import { OPPORTUNITY_EVAL_ATTEMPT_TIMEOUT_MS } from "../opportunity/opportunity.constants.js";
import { CASES as PREMISE_CASES } from "../premise/premise.cases.js";
import { PREMISE_EVAL_ATTEMPT_TIMEOUT_MS } from "../premise/premise.constants.js";
import { CASES as PROFILE_CASES } from "../profile/profile.cases.js";
import { PROFILE_EVAL_ATTEMPT_TIMEOUT_MS } from "../profile/profile.constants.js";
import type { CanarySuiteCorpus, CanarySuiteName } from "./canary.manifest.js";

export interface CanarySuiteDefinition {
  suite: CanarySuiteName;
  /** Harness entrypoint, relative to packages/protocol. */
  entrypoint: string;
  /** Model-config agents the harness pins (for provenance printing). */
  modelAgents: ModelAgent[];
  /** Per-attempt provider deadline the harness applies by default. */
  attemptTimeoutMs: number;
  /**
   * Ceiling of primary model invocations per run slot (premise runs either the
   * decomposer or the analyzer per case, but budgets assume the ceiling).
   * Judge (assertLLM) calls come on top and are counted separately.
   */
  primaryCallsPerRunCeiling: number;
  /** Committed corpus cases, in corpus order. Used to fingerprint selections. */
  cases: ReadonlyArray<{ id: string }>;
}

export const CANARY_SUITE_DEFINITIONS: Record<CanarySuiteName, CanarySuiteDefinition> = {
  matching: {
    suite: "matching",
    entrypoint: "eval/matching/matching.eval.ts",
    modelAgents: ["opportunityEvaluator"],
    attemptTimeoutMs: MATCHING_EVAL_ATTEMPT_TIMEOUT_MS,
    primaryCallsPerRunCeiling: 1,
    cases: MATCHING_CASES,
  },
  opportunity: {
    suite: "opportunity",
    entrypoint: "eval/opportunity/opportunity.eval.ts",
    modelAgents: ["opportunityPresenter"],
    attemptTimeoutMs: OPPORTUNITY_EVAL_ATTEMPT_TIMEOUT_MS,
    primaryCallsPerRunCeiling: 1,
    cases: OPPORTUNITY_CASES,
  },
  premise: {
    suite: "premise",
    entrypoint: "eval/premise/premise.eval.ts",
    modelAgents: ["premiseDecomposer", "premiseAnalyzer"],
    attemptTimeoutMs: PREMISE_EVAL_ATTEMPT_TIMEOUT_MS,
    primaryCallsPerRunCeiling: 2,
    cases: PREMISE_CASES,
  },
  profile: {
    suite: "profile",
    entrypoint: "eval/profile/profile.eval.ts",
    modelAgents: ["profileGenerator"],
    attemptTimeoutMs: PROFILE_EVAL_ATTEMPT_TIMEOUT_MS,
    primaryCallsPerRunCeiling: 1,
    cases: PROFILE_CASES,
  },
};

/** The corpus id surface {@link resolveCanaryManifest} consumes. */
export function canaryCorpora(): Record<CanarySuiteName, CanarySuiteCorpus> {
  const corpora = {} as Record<CanarySuiteName, CanarySuiteCorpus>;
  for (const definition of Object.values(CANARY_SUITE_DEFINITIONS)) {
    corpora[definition.suite] = { suite: definition.suite, caseIds: definition.cases.map((entry) => entry.id) };
  }
  return corpora;
}

/** Finds the committed corpus case objects for a resolved selection, in manifest order. */
export function selectCanaryCases(definition: CanarySuiteDefinition, caseIds: readonly string[]): Array<{ id: string }> {
  const byId = new Map(definition.cases.map((entry) => [entry.id, entry]));
  return caseIds.map((id) => {
    const found = byId.get(id);
    if (!found) throw new Error(`Case "${id}" not found in ${definition.suite} corpus`);
    return found;
  });
}
