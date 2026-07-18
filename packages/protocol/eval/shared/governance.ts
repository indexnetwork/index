/**
 * ER4 baseline governance: exact comparison compatibility and auditable
 * `--update-baseline` gating (IND-445).
 *
 * This module governs the *inputs* to the shared regression statistics; the
 * beta-binomial posterior-predictive comparison and Wilson intervals in
 * `stats.ts` / `baseline.ts` are intentionally untouched. Comparability is
 * assessed over recorded provenance — harness + harness version, model/judge
 * identity, selection/full-corpus status, corpus and scoring-config
 * fingerprints, run protocol, and completeness — and fails closed:
 *
 * - A *provable* mismatch (both sides carry the evidence and it differs) makes
 *   the pair `incompatible`. Incompatible cohorts are never diffed and can
 *   never produce a normal regression verdict.
 * - An *unprovable* dimension (schema-v1 legacy fingerprints, filtered current
 *   selections) is accepted under the "normal" evidence policy with explicit
 *   notes, and refused under "strict" — the same normal/strict split ER3
 *   established for v1 execution evidence.
 *
 * Baseline updates additionally require an operator reason, a complete
 * full-corpus unfiltered run, and a clean identifiable Git revision, and every
 * update persists a reviewable provenance/diff summary next to the baseline.
 */
import { EVAL_ARTIFACT_SCHEMA_VERSION, EVAL_LEGACY_UNAVAILABLE, fingerprintEvalConfig, isEvalArtifactV2, type EvalArtifactEnvelope, type EvalGitProvenance, type EvalRunMeta, type EvalSelection } from "./artifact.js";
import { writeEvalJsonFile } from "./artifact.io.js";
import { assertBaselineWriteEligible, diffBaseline, readBaselineArtifact } from "./baseline.js";
import type { EvalComparisonExitStatus } from "./cli.js";
import { computeRollingBaseline, type RollingExclusion } from "./rolling.js";
import type { EvalEvidencePolicy, EvalExecutionSummary } from "./runner.js";
import type { Regression, ScorecardLike } from "./types.js";

// ─── Comparability assessment ───────────────────────────────────────────────

export type EvalComparabilityStatus = "comparable" | "unprovable" | "incompatible";
export type EvalComparabilityDimension =
  | "harness"
  | "harness-version"
  | "models"
  | "selection"
  | "corpus"
  | "config"
  | "run-protocol"
  | "completeness";

/** One assessed compatibility dimension: what each side carries and why it gates. */
export interface EvalComparabilityFinding {
  dimension: EvalComparabilityDimension;
  baseline: string;
  current: string;
  message: string;
}

export interface EvalComparability {
  status: EvalComparabilityStatus;
  /** Provable gating mismatches. Any entry makes the pair incompatible. */
  mismatches: EvalComparabilityFinding[];
  /** Dimensions whose equality cannot be proven from recorded provenance. */
  unprovable: EvalComparabilityFinding[];
}

/** The current run's cohort identity, derived from its run meta + execution summary. */
export interface EvalComparisonSubject {
  harness: string;
  harnessVersion: string;
  models: string[];
  selection: EvalSelection;
  corpusFingerprint: string;
  configFingerprint: string;
  complete: boolean;
}

export function comparisonSubjectFromMeta(meta: EvalRunMeta, execution: EvalExecutionSummary): EvalComparisonSubject {
  return {
    harness: meta.harness,
    harnessVersion: meta.harnessVersion,
    models: meta.models,
    selection: meta.selection,
    corpusFingerprint: meta.corpusFingerprint,
    configFingerprint: meta.configFingerprint,
    complete: execution.complete,
  };
}

function formatModels(models: readonly string[]): string {
  return [...models].sort().join(", ");
}

function sameModelSet(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  return a.size === b.size && [...a].every((model) => b.has(model));
}

/**
 * Assesses exact comparison compatibility between the current run and a
 * baseline envelope. Pure provenance inspection — no statistics.
 */
export function assessBaselineComparability(
  current: EvalComparisonSubject,
  baseline: EvalArtifactEnvelope,
): EvalComparability {
  const mismatches: EvalComparabilityFinding[] = [];
  const unprovable: EvalComparabilityFinding[] = [];
  const mismatch = (dimension: EvalComparabilityDimension, baselineValue: string, currentValue: string, message: string): void => {
    mismatches.push({ dimension, baseline: baselineValue, current: currentValue, message });
  };
  const unknown = (dimension: EvalComparabilityDimension, baselineValue: string, currentValue: string, message: string): void => {
    unprovable.push({ dimension, baseline: baselineValue, current: currentValue, message });
  };

  if (baseline.harness !== current.harness) {
    mismatch("harness", baseline.harness, current.harness, "baseline belongs to a different harness");
  }
  if (baseline.harnessVersion !== current.harnessVersion) {
    mismatch("harness-version", baseline.harnessVersion, current.harnessVersion, "harness versions differ; scoring semantics may have changed");
  }
  if (!sameModelSet(baseline.models, current.models)) {
    mismatch("models", formatModels(baseline.models), formatModels(current.models), "configured model IDs differ; unlike model cohorts are never compared");
  }
  if (!baseline.selection.fullCorpus || Object.keys(baseline.selection.filters).length > 0) {
    mismatch(
      "selection",
      JSON.stringify(baseline.selection),
      JSON.stringify(current.selection),
      "baselines must be full-corpus and unfiltered",
    );
  }
  if (!current.complete) {
    mismatch("completeness", "complete", "incomplete", "incomplete current evidence is never comparable");
  }
  if (isEvalArtifactV2(baseline) && !baseline.completeness.complete) {
    mismatch("completeness", "incomplete", current.complete ? "complete" : "incomplete", "baseline carries incomplete execution evidence");
  }

  if (baseline.corpusFingerprint === EVAL_LEGACY_UNAVAILABLE) {
    unknown("corpus", EVAL_LEGACY_UNAVAILABLE, current.corpusFingerprint, "baseline corpus fingerprint is unavailable (legacy migration); corpus identity cannot be proven");
  } else if (!current.selection.fullCorpus) {
    unknown("corpus", baseline.corpusFingerprint, current.corpusFingerprint, "current run is filtered, so its corpus fingerprint covers only the selected cases; full-corpus identity cannot be proven");
  } else if (baseline.corpusFingerprint !== current.corpusFingerprint) {
    mismatch("corpus", baseline.corpusFingerprint, current.corpusFingerprint, "corpus fingerprints differ; cases were added, removed, or edited since the baseline");
  }

  if (baseline.configFingerprint === EVAL_LEGACY_UNAVAILABLE) {
    unknown("config", EVAL_LEGACY_UNAVAILABLE, current.configFingerprint, "baseline scoring-config fingerprint is unavailable (legacy migration); scoring-config identity cannot be proven");
  } else if (baseline.configFingerprint !== current.configFingerprint) {
    mismatch("config", baseline.configFingerprint, current.configFingerprint, "scoring-config fingerprints differ (judge toggle or judge model changed)");
  }

  if (!current.selection.fullCorpus || Object.keys(current.selection.filters).length > 0) {
    unknown("selection", JSON.stringify(baseline.selection), JSON.stringify(current.selection), "current run is filtered; comparison is restricted to the selected cases");
  }

  if (!isEvalArtifactV2(baseline)) {
    unknown(
      "run-protocol",
      `schema v1 (${baseline.source})`,
      "schema v2 (run)",
      "schema-v1 baseline carries no execution evidence; run protocol and completeness cannot be proven",
    );
  }

  const status: EvalComparabilityStatus = mismatches.length > 0 ? "incompatible" : unprovable.length > 0 ? "unprovable" : "comparable";
  return { status, mismatches, unprovable };
}

// ─── Scoring-config fingerprint + judge identity ────────────────────────────

/**
 * Judge model resolution, mirroring `src/shared/agent/tests/llm-assert.ts`.
 * Keep the fallback in sync with `assertLLM`'s default verifier model.
 */
export function resolveEvalJudgeModelId(env: Record<string, string | undefined> = process.env): string {
  return env.SMARTEST_VERIFIER_MODEL ?? "google/gemini-2.5-flash";
}

/**
 * Fingerprints the cohort-defining *scoring* configuration: the judge toggle
 * and judge model identity plus any harness-specific scorer parameters.
 *
 * Execution knobs (`--runs`, `--alpha`, `--attempt-timeout-ms`, evidence
 * policy) and selection filters deliberately stay out: they do not change what
 * a "pass" means, live in dedicated envelope fields, and would otherwise make
 * every knob tweak a fingerprint mismatch that poisons comparability.
 */
export function buildEvalScoringConfigFingerprint(options: {
  judge: boolean;
  judgeModelId?: string;
  scorerConfig?: Record<string, unknown>;
}): string {
  return fingerprintEvalConfig({
    judge: options.judge,
    judgeModel: options.judge ? (options.judgeModelId ?? resolveEvalJudgeModelId()) : null,
    ...(options.scorerConfig ?? {}),
  });
}

// ─── Governed comparison ────────────────────────────────────────────────────

export type EvalComparisonVerdict =
  | "no-baseline"
  | "compared"
  | "compared-unprovable"
  | "not-comparable-strict"
  | "incompatible";

export interface GovernedComparison {
  verdict: EvalComparisonVerdict;
  baseline: ScorecardLike | null;
  baselineEnvelope: EvalArtifactEnvelope | null;
  comparability: EvalComparability | null;
  regressions: Regression[];
  /** Current cases with scored runs absent from the baseline (legacy alias of `addedCaseIds` minus unscored). */
  skippedCaseIds: string[];
  /** Every current case absent from the baseline. */
  addedCaseIds: string[];
  /** Baseline cases absent from the current run. */
  removedCaseIds: string[];
  /** Current cases with zero terminal successful runs (execution failures). */
  unscoredCaseIds: string[];
  rollingExclusions: RollingExclusion[];
  /** Printable governance notes (mismatches, unprovable dimensions, exclusions). */
  notes: string[];
}

export function emptyGovernedComparison(verdict: EvalComparisonVerdict = "no-baseline"): GovernedComparison {
  return {
    verdict,
    baseline: null,
    baselineEnvelope: null,
    comparability: null,
    regressions: [],
    skippedCaseIds: [],
    addedCaseIds: [],
    removedCaseIds: [],
    unscoredCaseIds: [],
    rollingExclusions: [],
    notes: [],
  };
}

export interface GovernedComparisonOptions {
  scorecard: ScorecardLike;
  alpha: number;
  evidencePolicy: EvalEvidencePolicy;
  meta: EvalRunMeta;
  execution: EvalExecutionSummary;
  /** Path of the committed baseline artifact. */
  baselinePath: string;
  /** Compare against a rolling window of recent compatible complete reports instead. */
  rolling?: { runsDir: string; days: number; now?: Date };
  /**
   * Update mode: strict-unprovable pairs still produce a descriptive diff for
   * the update summary instead of refusing comparison outright.
   */
  forUpdate?: boolean;
}

function comparabilityNotes(comparability: EvalComparability): string[] {
  return [
    ...comparability.mismatches.map((finding) =>
      `not comparable (${finding.dimension}): ${finding.message} [baseline: ${finding.baseline} · current: ${finding.current}]`),
    ...comparability.unprovable.map((finding) => `comparability unprovable (${finding.dimension}): ${finding.message}`),
  ];
}

/**
 * The single governed comparison path every baseline-backed harness uses.
 *
 * Committed-baseline mode reads the envelope, assesses comparability, and only
 * runs the (unchanged) `diffBaseline` statistics when the cohorts are not
 * provably unlike. Rolling mode delegates input filtering to
 * {@link computeRollingBaseline} and reports every excluded artifact.
 */
export async function compareAgainstGovernedBaseline(options: GovernedComparisonOptions): Promise<GovernedComparison> {
  const subject = comparisonSubjectFromMeta(options.meta, options.execution);

  if (options.rolling) {
    const result = await computeRollingBaseline(options.rolling.runsDir, options.rolling.days, options.rolling.now ?? new Date(), {
      evidencePolicy: options.evidencePolicy,
      compatibility: {
        harness: subject.harness,
        harnessVersion: subject.harnessVersion,
        models: subject.models,
        // A filtered current run fingerprints only its selected cases, so its
        // corpus fingerprint cannot gate full-corpus rolling inputs.
        ...(subject.selection.fullCorpus ? { corpusFingerprint: subject.corpusFingerprint } : {}),
        configFingerprint: subject.configFingerprint,
      },
    });
    const notes = result.excluded.map((exclusion) => `rolling input excluded: ${exclusion.file} — ${exclusion.reason}`);
    if (!result.scorecard) {
      return { ...emptyGovernedComparison("no-baseline"), rollingExclusions: result.excluded, notes };
    }
    const diff = diffBaseline(options.scorecard, result.scorecard, options.alpha);
    return {
      verdict: "compared",
      baseline: result.scorecard,
      baselineEnvelope: null,
      comparability: null,
      ...diff,
      rollingExclusions: result.excluded,
      notes,
    };
  }

  const envelope = await readBaselineArtifact(options.baselinePath, { harness: options.meta.harness });
  if (!envelope) return emptyGovernedComparison("no-baseline");

  const comparability = assessBaselineComparability(subject, envelope);
  const notes = comparabilityNotes(comparability);
  if (comparability.status === "incompatible") {
    // Fail closed: provably unlike cohorts are never diffed, even descriptively.
    return { ...emptyGovernedComparison("incompatible"), baseline: envelope.payload, baselineEnvelope: envelope, comparability, notes };
  }
  if (comparability.status === "unprovable" && options.evidencePolicy === "strict" && !options.forUpdate) {
    return { ...emptyGovernedComparison("not-comparable-strict"), baseline: envelope.payload, baselineEnvelope: envelope, comparability, notes };
  }
  const diff = diffBaseline(options.scorecard, envelope.payload, options.alpha);
  return {
    verdict: comparability.status === "comparable" ? "compared" : "compared-unprovable",
    baseline: envelope.payload,
    baselineEnvelope: envelope,
    comparability,
    ...diff,
    rollingExclusions: [],
    notes,
  };
}

/** Regressions only count toward the verdict when a comparison actually ran. */
export function governedRegressionCount(comparison: GovernedComparison): number {
  return comparison.verdict === "compared" || comparison.verdict === "compared-unprovable"
    ? comparison.regressions.length
    : 0;
}

/**
 * Maps a governed comparison to the exit-code contract. During
 * `--update-baseline` the comparison against the *old* baseline is
 * reviewable evidence, not a gate, so incompatibility does not fail the run.
 */
export function governedComparisonExitStatus(
  comparison: GovernedComparison,
  options: { forUpdate?: boolean } = {},
): EvalComparisonExitStatus | undefined {
  switch (comparison.verdict) {
    case "compared":
    case "compared-unprovable":
      return "compared";
    case "incompatible":
      return options.forUpdate ? undefined : "incompatible";
    case "not-comparable-strict":
      return "not-comparable-strict";
    default:
      return undefined;
  }
}

/** Console rendering of the governance outcome (comparability, exclusions, case churn). */
export function formatGovernedComparison(
  comparison: GovernedComparison,
  options: { fullCorpus?: boolean } = {},
): string | null {
  const lines: string[] = [];
  if (comparison.verdict === "incompatible") {
    lines.push("⛔ Baseline comparison refused: provenance is provably incompatible.");
  } else if (comparison.verdict === "not-comparable-strict") {
    lines.push("⚠ Strict evidence policy: baseline comparability cannot be proven; comparison skipped.");
  } else if (comparison.verdict === "compared-unprovable") {
    lines.push("ℹ Baseline comparability is partially unprovable; compared under the normal evidence policy:");
  }
  for (const note of comparison.notes.slice(0, 20)) lines.push(`  ${note}`);
  if (comparison.notes.length > 20) lines.push(`  …and ${comparison.notes.length - 20} more note(s)`);
  if (options.fullCorpus && comparison.removedCaseIds.length > 0) {
    lines.push(`ℹ ${comparison.removedCaseIds.length} baseline case(s) absent from this run (removed from the corpus?):`);
    for (const id of comparison.removedCaseIds.slice(0, 10)) lines.push(`  ${id}`);
    if (comparison.removedCaseIds.length > 10) lines.push(`  …and ${comparison.removedCaseIds.length - 10} more`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

// ─── Baseline update governance ─────────────────────────────────────────────

/**
 * Permits a baseline update only from a complete, full-corpus, unfiltered run
 * at an identifiable clean Git revision, with an operator-supplied reason.
 */
export function assertBaselineUpdatePermitted(options: {
  meta: EvalRunMeta;
  execution: EvalExecutionSummary;
  reason: string | undefined;
}): void {
  if (!options.reason || options.reason.trim().length === 0) {
    throw new Error('--update-baseline requires --reason "<operator reason>": every baseline update must carry an auditable justification');
  }
  if (!options.execution.complete) {
    throw new Error(
      `Cannot update baseline from incomplete evidence: ${options.execution.completedRuns}/${options.execution.requestedRuns} requested runs completed (no missing terminal slots allowed)`,
    );
  }
  assertBaselineWriteEligible(options.meta);
}

export const EVAL_BASELINE_UPDATE_SUMMARY_TYPE = "index-eval/baseline-update-summary";

/** Compact provenance digest of one side of a baseline update. */
export interface BaselineArtifactDigest {
  schemaVersion: number;
  source: string;
  models: string[];
  runs: number;
  generatedAt: string;
  corpusFingerprint: string;
  configFingerprint: string;
  git: EvalGitProvenance;
  caseCount: number;
  ruleCount: number;
  aggregatePassRate: number;
}

/** The reviewable, deterministic summary printed and persisted on every baseline update. */
export interface BaselineUpdateSummary {
  artifactType: typeof EVAL_BASELINE_UPDATE_SUMMARY_TYPE;
  schemaVersion: 1;
  harness: string;
  harnessVersion: string;
  /** Deterministic: the run's completion time, not the wall clock at write time. */
  createdAt: string;
  reason: string;
  git: EvalGitProvenance;
  previous: BaselineArtifactDigest | null;
  next: BaselineArtifactDigest;
  comparability: EvalComparability | null;
  caseChanges: { added: string[]; removed: string[]; retainedCount: number };
  ruleChanges: { added: string[]; removed: string[] };
  aggregatePassRate: { previous: number | null; next: number; delta: number | null };
  /** Regressions vs the previous baseline (descriptive when comparability is unprovable). */
  regressions: Regression[];
  execution: EvalExecutionSummary;
}

function digestFromEnvelope(envelope: EvalArtifactEnvelope): BaselineArtifactDigest {
  return {
    schemaVersion: envelope.schemaVersion,
    source: envelope.source,
    models: [...envelope.models],
    runs: envelope.runs,
    generatedAt: envelope.payload.generatedAt,
    corpusFingerprint: envelope.corpusFingerprint,
    configFingerprint: envelope.configFingerprint,
    git: envelope.git,
    caseCount: envelope.payload.cases.length,
    ruleCount: envelope.payload.rules.length,
    aggregatePassRate: envelope.payload.aggregatePassRate,
  };
}

export function buildBaselineUpdateSummary(options: {
  scorecard: ScorecardLike;
  meta: EvalRunMeta;
  execution: EvalExecutionSummary;
  reason: string;
  comparison: GovernedComparison;
}): BaselineUpdateSummary {
  const previousEnvelope = options.comparison.baselineEnvelope;
  const previous = previousEnvelope ? digestFromEnvelope(previousEnvelope) : null;
  const currentIds = new Set(options.scorecard.cases.map((entry) => entry.caseId));
  const previousIds = new Set(previousEnvelope?.payload.cases.map((entry) => entry.caseId) ?? []);
  const currentRules = new Set(options.scorecard.rules.map((entry) => entry.rule));
  const previousRules = new Set(previousEnvelope?.payload.rules.map((entry) => entry.rule) ?? []);
  const previousAggregate = previousEnvelope?.payload.aggregatePassRate ?? null;
  return {
    artifactType: EVAL_BASELINE_UPDATE_SUMMARY_TYPE,
    schemaVersion: 1,
    harness: options.meta.harness,
    harnessVersion: options.meta.harnessVersion,
    createdAt: options.meta.completedAt,
    reason: options.reason,
    git: options.meta.git,
    previous,
    next: {
      schemaVersion: EVAL_ARTIFACT_SCHEMA_VERSION,
      source: "run",
      models: [...options.meta.models],
      runs: options.meta.runs,
      generatedAt: options.scorecard.generatedAt,
      corpusFingerprint: options.meta.corpusFingerprint,
      configFingerprint: options.meta.configFingerprint,
      git: options.meta.git,
      caseCount: options.scorecard.cases.length,
      ruleCount: options.scorecard.rules.length,
      aggregatePassRate: options.scorecard.aggregatePassRate,
    },
    comparability: options.comparison.comparability,
    caseChanges: {
      added: [...currentIds].filter((id) => !previousIds.has(id)).sort(),
      removed: [...previousIds].filter((id) => !currentIds.has(id)).sort(),
      retainedCount: [...currentIds].filter((id) => previousIds.has(id)).length,
    },
    ruleChanges: {
      added: [...currentRules].filter((rule) => !previousRules.has(rule)).sort(),
      removed: [...previousRules].filter((rule) => !currentRules.has(rule)).sort(),
    },
    aggregatePassRate: {
      previous: previousAggregate,
      next: options.scorecard.aggregatePassRate,
      delta: previousAggregate === null ? null : options.scorecard.aggregatePassRate - previousAggregate,
    },
    regressions: options.comparison.regressions,
    execution: options.execution,
  };
}

const pct = (rate: number): string => `${Math.round(rate * 1000) / 10}%`;

function digestLine(digest: BaselineArtifactDigest): string {
  return `schema v${digest.schemaVersion} (${digest.source}) · ${formatModels(digest.models)} · ${digest.caseCount} case(s) × ${digest.runs} run(s) `
    + `· aggregate ${pct(digest.aggregatePassRate)} · corpus ${digest.corpusFingerprint.slice(0, 12)} · config ${digest.configFingerprint.slice(0, 12)}`;
}

export function formatBaselineUpdateSummary(summary: BaselineUpdateSummary): string {
  const lines: string[] = [];
  lines.push(`\n=== Baseline update summary (${summary.harness}) ===`);
  lines.push(`reason: ${summary.reason}`);
  lines.push(`git: ${summary.git.revision} (${summary.git.dirty === false ? "clean" : "dirty/unknown"})`);
  lines.push(`previous: ${summary.previous ? digestLine(summary.previous) : "none (first governed baseline)"}`);
  lines.push(`next:     ${digestLine(summary.next)}`);
  if (summary.comparability) {
    lines.push(`comparability vs previous: ${summary.comparability.status}`);
    for (const finding of [...summary.comparability.mismatches, ...summary.comparability.unprovable]) {
      lines.push(`  ${finding.dimension}: ${finding.message}`);
    }
  }
  const cases = summary.caseChanges;
  lines.push(`cases: ${cases.added.length} added · ${cases.removed.length} removed · ${cases.retainedCount} retained`);
  for (const id of cases.added) lines.push(`  + ${id}`);
  for (const id of cases.removed) lines.push(`  - ${id}`);
  const rules = summary.ruleChanges;
  if (rules.added.length > 0 || rules.removed.length > 0) {
    lines.push(`rules: ${rules.added.length} added · ${rules.removed.length} removed`);
    for (const rule of rules.added) lines.push(`  + ${rule}`);
    for (const rule of rules.removed) lines.push(`  - ${rule}`);
  }
  const agg = summary.aggregatePassRate;
  const deltaText = agg.delta === null ? "" : ` (Δ ${agg.delta >= 0 ? "+" : "−"}${pct(Math.abs(agg.delta))})`;
  lines.push(
    agg.previous === null
      ? `aggregate pass-rate: ${pct(agg.next)}`
      : `aggregate pass-rate: ${pct(agg.previous)} → ${pct(agg.next)}${deltaText}`,
  );
  lines.push(
    summary.regressions.length === 0
      ? "regressions vs previous: none"
      : `regressions vs previous: ${summary.regressions.length}`,
  );
  for (const regression of summary.regressions) {
    lines.push(`  [${regression.kind}] ${regression.id}: ${pct(regression.before)} → ${pct(regression.after)} (p=${regression.pValue.toFixed(3)})`);
  }
  lines.push(`recovered retries: ${summary.execution.recoveredRuns} · attempts: ${summary.execution.totalAttempts} for ${summary.execution.requestedRuns} requested run(s)`);
  return lines.join("\n");
}

/** `<dir>/<name>.json` → `<dir>/<name>.update.json`, committed beside the baseline for review. */
export function baselineUpdateSummaryPath(baselinePath: string): string {
  return baselinePath.endsWith(".json")
    ? `${baselinePath.slice(0, -".json".length)}.update.json`
    : `${baselinePath}.update.json`;
}

export interface GovernedBaselineUpdateOptions {
  baselinePath: string;
  scorecard: ScorecardLike;
  meta: EvalRunMeta;
  execution: EvalExecutionSummary;
  reason: string | undefined;
  force?: boolean;
  /** The governed comparison against the baseline being replaced. */
  comparison: GovernedComparison;
  /** Harness-specific baseline writer (lean-case transforms live here). Must target `baselinePath`. */
  writeBaselineArtifact: () => Promise<void>;
}

/**
 * The only sanctioned baseline-update path: asserts the update gate, writes
 * the baseline through the harness's ER2 overwrite-safe writer, then persists
 * the reviewable update summary next to the baseline.
 *
 * The summary is written with `force` because it is the log of the latest
 * update; the baseline itself keeps ER2 overwrite consent (`--force`).
 */
export async function performGovernedBaselineUpdate(options: GovernedBaselineUpdateOptions): Promise<BaselineUpdateSummary> {
  assertBaselineUpdatePermitted({ meta: options.meta, execution: options.execution, reason: options.reason });
  const summary = buildBaselineUpdateSummary({
    scorecard: options.scorecard,
    meta: options.meta,
    execution: options.execution,
    reason: options.reason as string,
    comparison: options.comparison,
  });
  await options.writeBaselineArtifact();
  await writeEvalJsonFile(baselineUpdateSummaryPath(options.baselinePath), summary, { force: true });
  return summary;
}
