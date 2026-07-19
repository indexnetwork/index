/**
 * Canary execution plan + operator-visible budget model (IND-447).
 *
 * A plan is a pure, provider-free derivation from (committed manifest ×
 * committed corpora × pinned model config): the exact harness invocations the
 * canary will spawn, plus an honest budget estimate. Budget figures are
 * derived only from quantities the eval infrastructure actually records —
 * requested run slots, retry ceilings, and attempt deadlines. Token and cost
 * telemetry do not exist in the eval runner, so they are reported as
 * unavailable rather than fabricated.
 */
import path from "path";
import { buildEvalScoringConfigFingerprint, fingerprintEvalCorpus, resolveEvalJudgeModelId, type EvalGitProvenance } from "../shared/index.js";
import { CANARY_MAX_ATTEMPTS_PER_RUN, CANARY_MAX_REQUESTED_RUN_SLOTS, CANARY_MAX_RUNS_PER_CASE, CANARY_MAX_TOTAL_CASES, type CanaryManifest, type CanaryResolvedSelection, type CanarySuiteName } from "./canary.manifest.js";
import { selectCanaryCases, type CanarySuiteDefinition } from "./canary.suites.js";

export interface CanaryPlannedInvocation {
  suite: CanarySuiteName;
  caseId: string;
  /** Artifact file name (basename) inside the canary output directory. */
  artifactFile: string;
  /** Full argv after `bun`, relative to packages/protocol. */
  argv: string[];
  attemptTimeoutMs: number;
  /**
   * Fingerprint of the selected single-case corpus — identical to the
   * `corpusFingerprint` the harness will record in the run artifact, so
   * canary artifacts are comparable run-over-run per (suite, case).
   */
  corpusFingerprint: string;
}

export interface CanaryBudget {
  totalCases: number;
  runsPerCase: number;
  requestedRunSlots: number;
  maxAttemptsPerRun: number;
  /** Primary model invocations if every run slot succeeds first try. */
  primaryCallFloor: number;
  /** Primary model invocations at the full retry ceiling. */
  primaryCallCeiling: number;
  /** Judge calls run on top of primary calls; counts depend on per-case criteria. */
  judgeCallsNote: string;
  /** No token telemetry exists in the eval runner. Reported honestly. */
  tokenTelemetry: "unavailable";
  /** No cost telemetry exists in the eval runner. Reported honestly. */
  costTelemetry: "unavailable";
  /** Worst-case wall clock across primary attempts (excludes judge calls). */
  wallClockCeilingMs: number;
  caps: {
    maxTotalCases: number;
    maxRunsPerCase: number;
    maxRequestedRunSlots: number;
  };
}

export interface CanarySuitePlan {
  suite: CanarySuiteName;
  models: string[];
  attemptTimeoutMs: number;
  caseIds: string[];
  invocations: CanaryPlannedInvocation[];
}

export interface CanaryPlan {
  manifestDescription: string;
  manifestSchemaVersion: number;
  alpha: number;
  outDir: string;
  suites: CanarySuitePlan[];
  invocations: CanaryPlannedInvocation[];
  budget: CanaryBudget;
  /** Pinned judge (assertLLM) model id — part of every harness's config fingerprint. */
  judgeModelId: string;
  /** Scoring-config fingerprint each harness will record (judge on). */
  configFingerprint: string;
  /** The canary suites use chat models only; no embedding model is invoked. */
  embeddingModels: "none";
  git: EvalGitProvenance;
}

/** Filesystem-safe artifact name for one (suite, case) invocation. */
export function canaryArtifactFileName(suite: CanarySuiteName, caseId: string): string {
  return `${suite}--${caseId.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`;
}

export interface BuildCanaryPlanOptions {
  manifest: CanaryManifest;
  selection: CanaryResolvedSelection;
  definitions: Record<CanarySuiteName, CanarySuiteDefinition>;
  /** Output directory for run artifacts, relative to packages/protocol or absolute. */
  outDir: string;
  /** Injected for provider-free tests; defaults to the live model config. */
  resolveModelName: (agent: string) => string;
  git: EvalGitProvenance;
  judgeModelId?: string;
}

export function buildCanaryPlan(options: BuildCanaryPlanOptions): CanaryPlan {
  const { manifest, selection, definitions, outDir } = options;
  const judgeModelId = options.judgeModelId ?? resolveEvalJudgeModelId();
  const suites: CanarySuitePlan[] = [];

  for (const resolved of selection.suites) {
    const definition = definitions[resolved.suite];
    const models = [...new Set(definition.modelAgents.map((agent) => options.resolveModelName(agent)))];
    const invocations: CanaryPlannedInvocation[] = resolved.caseIds.map((caseId) => {
      const artifactFile = canaryArtifactFileName(resolved.suite, caseId);
      return {
        suite: resolved.suite,
        caseId,
        artifactFile,
        argv: [
          definition.entrypoint,
          "--case",
          caseId,
          "--runs",
          String(selection.runsPerCase),
          "--alpha",
          String(manifest.alpha),
          "--no-save",
          "--report",
          path.join(outDir, artifactFile),
        ],
        attemptTimeoutMs: definition.attemptTimeoutMs,
        corpusFingerprint: fingerprintEvalCorpus(selectCanaryCases(definition, [caseId])),
      };
    });
    suites.push({
      suite: resolved.suite,
      models,
      attemptTimeoutMs: definition.attemptTimeoutMs,
      caseIds: [...resolved.caseIds],
      invocations,
    });
  }

  const perSuiteSlots = (suite: CanarySuitePlan): number => suite.caseIds.length * selection.runsPerCase;
  const budget: CanaryBudget = {
    totalCases: selection.totalCases,
    runsPerCase: selection.runsPerCase,
    requestedRunSlots: selection.requestedRunSlots,
    maxAttemptsPerRun: CANARY_MAX_ATTEMPTS_PER_RUN,
    primaryCallFloor: suites.reduce((sum, suite) => sum + perSuiteSlots(suite), 0),
    primaryCallCeiling: suites.reduce(
      (sum, suite) =>
        sum + perSuiteSlots(suite) * CANARY_MAX_ATTEMPTS_PER_RUN * definitions[suite.suite].primaryCallsPerRunCeiling,
      0,
    ),
    judgeCallsNote:
      "judge (assertLLM) calls run per satisfied criterion on each successful run; exact counts are not statically knowable and are not separately metered",
    tokenTelemetry: "unavailable",
    costTelemetry: "unavailable",
    wallClockCeilingMs: suites.reduce(
      (sum, suite) => sum + perSuiteSlots(suite) * CANARY_MAX_ATTEMPTS_PER_RUN * suite.attemptTimeoutMs,
      0,
    ),
    caps: {
      maxTotalCases: CANARY_MAX_TOTAL_CASES,
      maxRunsPerCase: CANARY_MAX_RUNS_PER_CASE,
      maxRequestedRunSlots: CANARY_MAX_REQUESTED_RUN_SLOTS,
    },
  };

  return {
    manifestDescription: manifest.description,
    manifestSchemaVersion: manifest.schemaVersion,
    alpha: manifest.alpha,
    outDir,
    suites,
    invocations: suites.flatMap((suite) => suite.invocations),
    budget,
    judgeModelId,
    configFingerprint: buildEvalScoringConfigFingerprint({ judge: true, judgeModelId }),
    embeddingModels: "none",
    git: options.git,
  };
}

const minutes = (ms: number): string => `${Math.round(ms / 60_000)}m`;

/** The pre-execution provenance + budget block printed before any provider call. */
export function formatCanaryPlanText(plan: CanaryPlan): string {
  const lines: string[] = [];
  lines.push("=== Eval canary plan (provider-free) ===");
  lines.push(`manifest: schema v${plan.manifestSchemaVersion} — ${plan.manifestDescription}`);
  lines.push(`git: ${plan.git.revision} (${plan.git.dirty === false ? "clean" : plan.git.dirty === true ? "dirty" : "unknown"})`);
  lines.push(`alpha: ${plan.alpha} · judge model: ${plan.judgeModelId} · config fingerprint: ${plan.configFingerprint.slice(0, 16)}`);
  lines.push(`embedding models: ${plan.embeddingModels} (canary suites invoke chat models only)`);
  lines.push(
    `caps: ≤${plan.budget.caps.maxTotalCases} cases · ≤${plan.budget.caps.maxRunsPerCase} runs/case · ≤${plan.budget.caps.maxRequestedRunSlots} run slots`,
  );
  lines.push("");
  for (const suite of plan.suites) {
    lines.push(
      `suite ${suite.suite}: ${suite.caseIds.length} case(s) × ${plan.budget.runsPerCase} run(s) · models: ${suite.models.join(", ")} · attempt timeout ${suite.attemptTimeoutMs}ms`,
    );
    for (const invocation of suite.invocations) {
      lines.push(`  ${invocation.caseId} · corpus ${invocation.corpusFingerprint.slice(0, 12)} → ${invocation.artifactFile}`);
    }
  }
  lines.push("");
  lines.push("=== Budget estimate ===");
  lines.push(`cases: ${plan.budget.totalCases} · runs/case: ${plan.budget.runsPerCase} · requested run slots: ${plan.budget.requestedRunSlots}`);
  lines.push(
    `primary model calls: ${plan.budget.primaryCallFloor} (all-first-try floor) … ${plan.budget.primaryCallCeiling} (retry ceiling, ≤${plan.budget.maxAttemptsPerRun} attempts/slot)`,
  );
  lines.push(`judge calls: ${plan.budget.judgeCallsNote}`);
  lines.push(`tokens: ${plan.budget.tokenTelemetry} · cost: ${plan.budget.costTelemetry} (no token/cost telemetry exists in the eval runner)`);
  lines.push(
    `wall-clock ceiling (primary attempts only): ${minutes(plan.budget.wallClockCeilingMs)} — the workflow timeout-minutes is the operative hard stop`,
  );
  return lines.join("\n");
}
