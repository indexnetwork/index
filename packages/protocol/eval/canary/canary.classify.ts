/**
 * Canary outcome classification, exit-code aggregation, leak scanning, and the
 * run summary artifact (IND-447).
 *
 * Classification leans on the existing governance exit-code contract
 * (0 pass · 1 regression · 2 execution/artifact error · 3 insufficient strict
 * evidence) plus the artifact's recorded completeness — it does not invent a
 * parallel taxonomy. The canary informs; it never gates or auto-reverts.
 */
import { EVAL_EXIT_EXECUTION_ERROR, EVAL_EXIT_INSUFFICIENT_EVIDENCE, EVAL_EXIT_PASS, EVAL_EXIT_REGRESSION, type EvalGitProvenance } from "../shared/index.js";
import type { CanaryBudget, CanaryPlan } from "./canary.plan.js";
import type { CanarySuiteName } from "./canary.manifest.js";

export const CANARY_SUMMARY_ARTIFACT_TYPE = "index-eval/canary-summary";
export const CANARY_SUMMARY_SCHEMA_VERSION = 1;

/**
 * Operator-facing alert classes:
 * - `pass`: compared against the committed baseline; no measured regression.
 * - `regression`: genuine measured eval regression (harness exit 1).
 * - `provider-incident`: execution failure / incomplete evidence (exit 2 with
 *   incomplete or missing artifact, spawn failure, or a redaction quarantine).
 * - `baseline-incompatibility`: complete evidence but the governed comparison
 *   refused or errored (exit 2 with a complete artifact).
 * - `insufficient-evidence`: governance could not produce a verdict (exit 3).
 */
export type CanaryInvocationClass =
  | "pass"
  | "regression"
  | "provider-incident"
  | "baseline-incompatibility"
  | "insufficient-evidence";

export interface CanaryClassificationInput {
  /** Harness process exit code; null when the process could not be spawned/reaped. */
  exitCode: number | null;
  artifactPresent: boolean;
  /** From the artifact's completeness evidence; null when unknown/unreadable. */
  artifactComplete: boolean | null;
}

export interface CanaryClassification {
  classification: CanaryInvocationClass;
  detail: string;
}

export function classifyCanaryInvocation(input: CanaryClassificationInput): CanaryClassification {
  if (input.exitCode === EVAL_EXIT_PASS) {
    return { classification: "pass", detail: "compared against committed baseline; no measured regression" };
  }
  if (input.exitCode === EVAL_EXIT_REGRESSION) {
    return { classification: "regression", detail: "measured regression vs the committed baseline (see artifact + logs)" };
  }
  if (input.exitCode === EVAL_EXIT_INSUFFICIENT_EVIDENCE) {
    return { classification: "insufficient-evidence", detail: "governance could not produce a verdict (exit 3)" };
  }
  if (input.exitCode === EVAL_EXIT_EXECUTION_ERROR && input.artifactPresent && input.artifactComplete === true) {
    return {
      classification: "baseline-incompatibility",
      detail: "execution evidence is complete but the run exited 2 — governed comparison refused (incompatible baseline) or artifact error; inspect governance notes in the log",
    };
  }
  return {
    classification: "provider-incident",
    detail:
      input.exitCode === null
        ? "harness process failed to run to completion"
        : input.artifactPresent
          ? "incomplete execution evidence (provider failures/timeouts retained in the artifact)"
          : "execution failed before a run artifact could be persisted",
  };
}

/**
 * Aggregate exit-code policy, reusing the shared code points: any incident or
 * incompatibility → 2, else any insufficient evidence → 3, else any measured
 * regression → 1, else 0.
 */
export function aggregateCanaryExitCode(classes: readonly CanaryInvocationClass[]): number {
  if (classes.some((c) => c === "provider-incident" || c === "baseline-incompatibility")) return EVAL_EXIT_EXECUTION_ERROR;
  if (classes.some((c) => c === "insufficient-evidence")) return EVAL_EXIT_INSUFFICIENT_EVIDENCE;
  if (classes.some((c) => c === "regression")) return EVAL_EXIT_REGRESSION;
  return EVAL_EXIT_PASS;
}

// ─── Redaction / leak scanning ─────────────────────────────────────────────

const SECRETLIKE_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;
const MIN_SECRET_LENGTH = 8;
const PROVIDER_KEY_PATTERN = /\b(?:sk|rk)-[A-Za-z0-9_-]{16,}/;

/**
 * Final upload guard on top of ER3 sanitization: scans content for raw values
 * of secret-like environment variables and provider-key-shaped strings.
 * Returns *descriptors only* (env var names / pattern labels) — never values.
 */
export function scanForSecretLeaks(content: string, env: Record<string, string | undefined> = process.env): string[] {
  const findings: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!SECRETLIKE_ENV_NAME.test(name)) continue;
    if (typeof value !== "string" || value.length < MIN_SECRET_LENGTH) continue;
    if (content.includes(value)) findings.push(`env:${name}`);
  }
  if (PROVIDER_KEY_PATTERN.test(content)) findings.push("pattern:provider-key-like");
  return findings;
}

// ─── Run summary artifact ──────────────────────────────────────────────────

export interface CanaryInvocationRecord {
  suite: CanarySuiteName;
  caseId: string;
  artifactFile: string;
  exitCode: number | null;
  classification: CanaryInvocationClass;
  detail: string;
  durationMs: number;
  artifactPresent: boolean;
  artifactComplete: boolean | null;
  /** From the artifact's execution evidence when readable. */
  execution: { requestedRuns: number; completedRuns: number; totalAttempts: number } | null;
}

export interface CanaryRedactionQuarantine {
  file: string;
  /** Descriptors only (env var names / pattern labels), never secret values. */
  findings: string[];
}

export interface CanarySummary {
  artifactType: typeof CANARY_SUMMARY_ARTIFACT_TYPE;
  schemaVersion: typeof CANARY_SUMMARY_SCHEMA_VERSION;
  manifestDescription: string;
  git: EvalGitProvenance;
  startedAt: string;
  completedAt: string;
  budget: CanaryBudget;
  /** Post-execution actuals derived from recorded evidence only. */
  actuals: {
    invocationsExecuted: number;
    totalAttempts: number | null;
    wallClockMs: number;
    tokenTelemetry: "unavailable";
    costTelemetry: "unavailable";
  };
  invocations: CanaryInvocationRecord[];
  classificationCounts: Record<CanaryInvocationClass, number>;
  redactionQuarantines: CanaryRedactionQuarantine[];
  exitCode: number;
}

export function buildCanarySummary(options: {
  plan: CanaryPlan;
  invocations: CanaryInvocationRecord[];
  redactionQuarantines: CanaryRedactionQuarantine[];
  startedAt: string;
  completedAt: string;
}): CanarySummary {
  const counts: Record<CanaryInvocationClass, number> = {
    pass: 0,
    regression: 0,
    "provider-incident": 0,
    "baseline-incompatibility": 0,
    "insufficient-evidence": 0,
  };
  for (const invocation of options.invocations) counts[invocation.classification] += 1;
  const attemptsKnown = options.invocations.every((invocation) => invocation.execution !== null);
  const baseExit = aggregateCanaryExitCode(options.invocations.map((invocation) => invocation.classification));
  const exitCode = options.redactionQuarantines.length > 0 ? EVAL_EXIT_EXECUTION_ERROR : baseExit;
  return {
    artifactType: CANARY_SUMMARY_ARTIFACT_TYPE,
    schemaVersion: CANARY_SUMMARY_SCHEMA_VERSION,
    manifestDescription: options.plan.manifestDescription,
    git: options.plan.git,
    startedAt: options.startedAt,
    completedAt: options.completedAt,
    budget: options.plan.budget,
    actuals: {
      invocationsExecuted: options.invocations.length,
      totalAttempts: attemptsKnown
        ? options.invocations.reduce((sum, invocation) => sum + (invocation.execution?.totalAttempts ?? 0), 0)
        : null,
      wallClockMs: options.invocations.reduce((sum, invocation) => sum + invocation.durationMs, 0),
      tokenTelemetry: "unavailable",
      costTelemetry: "unavailable",
    },
    invocations: options.invocations,
    classificationCounts: counts,
    redactionQuarantines: options.redactionQuarantines,
    exitCode,
  };
}

const CLASS_LABELS: Record<CanaryInvocationClass, string> = {
  pass: "✅ pass",
  regression: "📉 regression",
  "provider-incident": "🔌 provider incident / execution failure",
  "baseline-incompatibility": "⛔ baseline incompatibility",
  "insufficient-evidence": "❓ insufficient evidence",
};

/** GitHub job-summary markdown. Informational only — the canary never gates. */
export function formatCanarySummaryMarkdown(summary: CanarySummary): string {
  const lines: string[] = [];
  lines.push("## Eval live canary");
  lines.push("");
  lines.push(`Measurement-only run at \`${summary.git.revision.slice(0, 12)}\` — alerts inform, they do not gate or auto-revert.`);
  lines.push("");
  lines.push("| class | count |");
  lines.push("| :-- | --: |");
  for (const [cls, label] of Object.entries(CLASS_LABELS) as Array<[CanaryInvocationClass, string]>) {
    lines.push(`| ${label} | ${summary.classificationCounts[cls]} |`);
  }
  lines.push("");
  lines.push("| suite | case | exit | classification |");
  lines.push("| :-- | :-- | --: | :-- |");
  for (const invocation of summary.invocations) {
    lines.push(
      `| ${invocation.suite} | \`${invocation.caseId}\` | ${invocation.exitCode ?? "—"} | ${CLASS_LABELS[invocation.classification]} |`,
    );
  }
  lines.push("");
  lines.push(
    `Budget: ${summary.budget.requestedRunSlots} requested run slots (${summary.budget.totalCases} cases × ${summary.budget.runsPerCase} runs) · `
      + `primary calls ${summary.budget.primaryCallFloor}–${summary.budget.primaryCallCeiling} · tokens/cost: unavailable (no runner telemetry).`,
  );
  lines.push(
    `Actuals: ${summary.actuals.invocationsExecuted} invocation(s) · attempts: ${summary.actuals.totalAttempts ?? "unavailable"} · `
      + `wall clock ${Math.round(summary.actuals.wallClockMs / 1000)}s · tokens/cost: unavailable.`,
  );
  if (summary.redactionQuarantines.length > 0) {
    lines.push("");
    lines.push(`⚠️ ${summary.redactionQuarantines.length} file(s) quarantined (deleted before upload) by the leak scan:`);
    for (const quarantine of summary.redactionQuarantines) {
      lines.push(`- \`${quarantine.file}\`: ${quarantine.findings.join(", ")}`);
    }
  }
  lines.push("");
  lines.push(`Exit code: \`${summary.exitCode}\` (0 pass · 1 regression · 2 incident/incompatibility · 3 insufficient evidence).`);
  return lines.join("\n");
}
