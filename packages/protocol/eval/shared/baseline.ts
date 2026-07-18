import { buildEvalArtifact, EVAL_BASELINE_ARTIFACT_TYPE, EVAL_RUN_REPORT_ARTIFACT_TYPE, type EvalArtifactEnvelope, type EvalRunMeta } from "./artifact.js";
import { readEvalArtifact, writeEvalArtifact } from "./artifact.io.js";
import { summarizeExecution } from "./runner.js";
import { predictivePValue } from "./stats.js";
import type { CaseResultLike, Regression, ScorecardLike } from "./types.js";

/** The explicit added/removed/skipped case report attached to every baseline diff. */
export interface BaselineDiff {
  regressions: Regression[];
  /** Current cases with scored runs that are absent from the baseline (never regressions). */
  skippedCaseIds: string[];
  /** Every current case absent from the baseline, including unscored ones. */
  addedCaseIds: string[];
  /** Baseline cases absent from the current run. */
  removedCaseIds: string[];
  /** Current cases with zero terminal successful runs (execution failures, not scoring failures). */
  unscoredCaseIds: string[];
}

/**
 * Compares a current scorecard against a baseline and returns any regressions.
 *
 * A regression is a case or rule where the current pass count is significantly
 * lower than expected from the baseline evidence (one-sided beta-binomial
 * posterior-predictive test at significance level alpha). New cases (absent from
 * the baseline) are never regressions; they are reported in `skippedCaseIds`.
 *
 * @param current - The scorecard produced by the current run.
 * @param baseline - The previously saved baseline scorecard, or `null` if none exists.
 * @param alpha - Significance level for the one-sided test.
 * @returns Detected regressions plus explicit added/removed/skipped case reports.
 */
export function diffBaseline(
  current: ScorecardLike,
  baseline: ScorecardLike | null,
  alpha = 0.05,
): BaselineDiff {
  if (!baseline) return { regressions: [], skippedCaseIds: [], addedCaseIds: [], removedCaseIds: [], unscoredCaseIds: [] };
  const regressions: Regression[] = [];
  const skippedCaseIds: string[] = [];

  const baseCases = new Map(baseline.cases.map((c) => [c.caseId, c]));
  for (const c of current.cases) {
    if (c.runs === 0) continue; // execution failures are not domain-scoring failures
    const base = baseCases.get(c.caseId);
    if (base === undefined) {
      skippedCaseIds.push(c.caseId);
      continue;
    }
    const pValue = predictivePValue(c.passes, c.runs, base.passes, base.runs);
    if (pValue <= alpha) {
      regressions.push({ id: c.caseId, kind: "case", before: base.passRate, after: c.passRate, pValue });
    }
  }

  const baseByRule = new Map<string, { passes: number; runs: number }>();
  for (const c of baseline.cases) {
    const acc = baseByRule.get(c.rule) ?? { passes: 0, runs: 0 };
    acc.passes += c.passes;
    acc.runs += c.runs;
    baseByRule.set(c.rule, acc);
  }
  const comparableByRule = new Map<string, { passes: number; runs: number }>();
  for (const c of current.cases) {
    if (c.runs === 0 || !baseCases.has(c.caseId)) continue;
    const acc = comparableByRule.get(c.rule) ?? { passes: 0, runs: 0 };
    acc.passes += c.passes;
    acc.runs += c.runs;
    comparableByRule.set(c.rule, acc);
  }
  for (const [rule, acc] of comparableByRule.entries()) {
    const base = baseByRule.get(rule);
    if (base === undefined || acc.runs === 0 || base.runs === 0) continue;
    const before = base.passes / base.runs;
    const after = acc.passes / acc.runs;
    const pValue = predictivePValue(acc.passes, acc.runs, base.passes, base.runs);
    if (pValue <= alpha) {
      regressions.push({ id: rule, kind: "rule", before, after, pValue });
    }
  }

  const currentIds = new Set(current.cases.map((c) => c.caseId));
  return {
    regressions,
    skippedCaseIds,
    addedCaseIds: current.cases.filter((c) => !baseCases.has(c.caseId)).map((c) => c.caseId),
    removedCaseIds: baseline.cases.filter((c) => !currentIds.has(c.caseId)).map((c) => c.caseId),
    unscoredCaseIds: current.cases.filter((c) => c.runs === 0).map((c) => c.caseId),
  };
}

/**
 * Reads a committed baseline through the versioned artifact envelope.
 *
 * The file must be a valid `index-eval/baseline` envelope for the given
 * harness; corrupt files, legacy unversioned scorecards, unknown schema
 * versions, and incompatible artifact types all fail with actionable errors
 * instead of being trusted through a cast.
 *
 * @param path - Absolute or relative path to the baseline JSON file.
 * @param options.harness - The harness that owns this baseline.
 * @returns The validated baseline scorecard payload, or `null` if the file does not exist.
 */
export async function readBaseline<T extends ScorecardLike>(
  path: string,
  options: { harness: string },
): Promise<T | null> {
  const envelope = await readBaselineArtifact<T>(path, options);
  return envelope?.payload ?? null;
}

/**
 * Reads a committed baseline as its full versioned envelope, preserving the
 * provenance (fingerprints, models, selection, git, completeness) the ER4
 * comparability assessment gates on. Returns `null` when the file is missing.
 */
export async function readBaselineArtifact<T extends ScorecardLike>(
  path: string,
  options: { harness: string },
): Promise<EvalArtifactEnvelope<T> | null> {
  return readEvalArtifact<T>(path, {
    expectedType: EVAL_BASELINE_ARTIFACT_TYPE,
    expectedHarness: options.harness,
  });
}

/**
 * The write-eligibility gate for committed baselines (IND-445): complete
 * evidence with no missing terminal slots, a full-corpus unfiltered
 * selection, and an identifiable clean Git revision. Enforced at the shared
 * writer choke point so no harness can bypass it.
 */
export function assertBaselineWriteEligible(meta: EvalRunMeta): void {
  const execution = summarizeExecution(meta.execution);
  if (!execution.complete) {
    throw new Error(
      `Refusing to write baseline from incomplete evidence: ${execution.completedRuns}/${execution.requestedRuns} requested runs completed`,
    );
  }
  if (!meta.selection.fullCorpus || Object.keys(meta.selection.filters).length > 0) {
    throw new Error("Refusing to write baseline from a filtered run: committed baselines require a full-corpus, unfiltered run");
  }
  if (meta.git.revision === "unknown") {
    throw new Error("Refusing to write baseline without an identifiable Git revision: run from a Git checkout");
  }
  if (meta.git.dirty !== false) {
    throw new Error("Refusing to write baseline from a dirty (or unverifiable) working tree: commit or stash local changes first");
  }
}

/**
 * Writes a scorecard to disk as a versioned, validated baseline artifact.
 *
 * The committed baseline is a diff target, so verbose per-run detail (model
 * reasoning, candidate outcomes) is best stripped to keep `--update-baseline`
 * diffs lean. Pass `leanCase` to transform each case before writing (e.g. drop
 * per-run candidate payloads); the full detail lives in the run report instead
 * (see {@link writeRunReport}).
 *
 * Writes use a same-directory temp file plus an atomic no-replace commit by
 * default; `force` opts into atomic rename replacement (the CLI's `--force`).
 *
 * @param path - Absolute or relative path to write to.
 * @param sc - The scorecard to persist.
 * @param opts.meta - Run provenance recorded in the envelope.
 * @param opts.leanCase - Optional per-case transform applied before serialization.
 * @param opts.force - Explicit consent to overwrite an existing baseline.
 */
export async function writeBaseline<C extends CaseResultLike>(
  path: string,
  sc: ScorecardLike<C>,
  opts: { meta: EvalRunMeta; leanCase?: (c: C) => C; force?: boolean },
): Promise<void> {
  assertBaselineWriteEligible(opts.meta);
  const leanCase = opts.leanCase ?? ((c: C) => c);
  const lean: ScorecardLike<C> = { ...sc, cases: sc.cases.map(leanCase) };
  const envelope = buildEvalArtifact(EVAL_BASELINE_ARTIFACT_TYPE, lean, opts.meta);
  await writeEvalArtifact(path, envelope, { force: opts.force });
}

/**
 * Writes a full run report to disk: the scorecard *including* every per-run
 * detail, wrapped in the same versioned envelope as baselines (with
 * `artifactType: "index-eval/run-report"`). This is the explanatory artifact a
 * reviewer or a report skill reads to see the agent's own justification for
 * each score. Written on demand via the `--report` flag and auto-saved for
 * full-corpus runs; never committed.
 *
 * @param path - Absolute or relative path to write to (parent dirs are created).
 * @param sc - The scorecard to persist, with detail intact.
 * @param opts.meta - Run provenance recorded in the envelope.
 * @param opts.force - Explicit consent to overwrite an existing report.
 */
export async function writeRunReport(
  path: string,
  sc: ScorecardLike,
  opts: { meta: EvalRunMeta; force?: boolean },
): Promise<void> {
  const envelope = buildEvalArtifact(EVAL_RUN_REPORT_ARTIFACT_TYPE, sc, opts.meta);
  await writeEvalArtifact(path, envelope, { force: opts.force });
}
