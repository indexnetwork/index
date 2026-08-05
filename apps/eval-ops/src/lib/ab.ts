/**
 * Reading a discovery-ab run report as the pair it is.
 *
 * The artifact holds no comparison. It holds two sides filed as `payload.rules`
 * (`a` and `b`), one case row per side per repetition, and each side's
 * configuration repeated on every row it owns as `configDeltas`. There is
 * deliberately no top-level `configs`/`configDiff`: the governed envelope and
 * scorecard schemas are `.strict()` (packages/protocol/eval/shared/artifact.ts),
 * so per-case `configDeltas` is where a configuration legally lives. Everything
 * this module returns is derived from those rows.
 *
 * Pure and dependency-free so the run view can render it without deriving
 * anything of its own.
 */
import { SIDE_IDS } from '../../../../packages/protocol/eval/ops/ops.sides';
import type { Artifact, ArtifactCase } from '../api/client';

export type AbSideId = (typeof SIDE_IDS)[number];

/** What one side gave one flag, as its own case rows record it. */
export type AbSideValue =
  /** Every row on this side recorded the same value. */
  | { kind: 'set'; value: string }
  /** This side's rows exist and none of them recorded the key: the flag was not set. */
  | { kind: 'unset' }
  /**
   * This side produced no rows at all, so nothing on disk says what it was.
   * Distinct from `unset` on purpose: a side whose child died before scoring
   * anything was configured, and calling that "unset" would state a
   * configuration the run never had.
   */
  | { kind: 'unrecorded' }
  /**
   * The side's rows disagree. The engine refuses to write this
   * (`assertAbConfigProvenance` fails the run before the artifact exists), so
   * seeing it means the artifact is not what the engine produces — reporting it
   * is the only honest option, since picking one of the values would state a
   * configuration that was not run.
   */
  | { kind: 'inconsistent'; values: string[]; unsetOnSomeRows: boolean };

/** One flag, as both sides recorded it. */
export interface AbConfigRow {
  key: string;
  a: AbSideValue;
  b: AbSideValue;
  /** True when the two sides did not record the same value — the run's subject. */
  differs: boolean;
}

/** One side's outcome, summed from the rows it owns. */
export interface AbSideSummary {
  id: AbSideId;
  /** The rate the artifact states for this side, in `payload.rules`. */
  passRate: number;
  /** Distinct cases, not rows: a repetition is a row of its own. */
  caseCount: number;
  /** Case-runs, summed across the side's rows. */
  passes: number;
  runs: number;
}

/**
 * What retrieval did on one side of one case, folded across its repetitions.
 *
 * `targetRank` and `evidenceTypes` are not diagnostics: they are the outcome
 * measures of retrieval, and retrieval is the thing this harness varies. Two
 * sides can pass every repetition and still have found the target at a
 * different rank or through different evidence — which is a real effect of the
 * configuration, invisible in the pass rates. The first live run is exactly
 * that case: both sides pass, side a finds the target through `intent` and side
 * b through `premise`.
 */
export interface AbRetrieval {
  /**
   * False when no repetition carried these fields at all, so nothing about
   * retrieval can be read — distinct from a recorded miss.
   */
  recorded: boolean;
  /**
   * Distinct final ranks the target came back at, ascending. `null` is a
   * recorded miss: the run happened and the target was not returned.
   */
  ranks: (number | null)[];
  /** Distinct evidence types the target was found through, sorted. */
  evidenceTypes: string[];
}

/**
 * One case on one side, with its repetitions folded together.
 *
 * The artifact files every repetition as a case row of its own
 * (`<case>/<side>/r<n>`, one successful run each), so a repeated case is only
 * legible once its rows are summed — and `flaky` is only computable there. Every
 * row's own `flaky` is necessarily false, because the schema defines the flag as
 * `passes > 0 && passes < runs` (packages/protocol/eval/shared/artifact.ts) and
 * a row never has more than one run.
 */
export interface AbSideCase {
  /** Rows the artifact holds for this case on this side. */
  repetitions: number;
  /** Successful terminal runs; the schema defines a row's `runs` as exactly that. */
  runs: number;
  passes: number;
  passRate: number;
  /** The schema's own definition, applied across the repetitions. */
  flaky: boolean;
  /** How this side found the target, not just whether it scored. */
  retrieval: AbRetrieval;
}

/** One case, as both sides ran it. */
export interface AbCasePair {
  /** The case as it was selected, with the side and repetition segments removed. */
  id: string;
  a: AbSideCase | null;
  b: AbSideCase | null;
  /** b − a, or null when a side scored none of this case's repetitions. */
  delta: number | null;
  /** True when both sides scored it and their pass rates are not equal. */
  differs: boolean;
  /**
   * True when both sides recorded retrieval and did not record the same
   * outcome. Independent of `differs`: equal pass rates with unequal retrieval
   * is the case this harness exists to catch, and reporting it as "same" hides
   * the only thing the run measured.
   */
  retrievalDiffers: boolean;
  /** The sides that both passed and failed this case across its repetitions. */
  flakySides: AbSideId[];
}

/**
 * What the run view renders.
 *
 * `no-verdict` is not an error state: it is the engine's own outcome for a run
 * whose sides did not both score everything (`resolveAbRunOutcome`, exit 3), and
 * the configuration is still shown because what was configured is a fact of the
 * run even when the outcome is not comparable.
 */
export type AbView =
  | {
      kind: 'no-verdict';
      reason: string;
      config: AbConfigRow[];
      unpairedCaseIds: string[];
    }
  | {
      kind: 'comparison';
      sides: Record<AbSideId, AbSideSummary>;
      config: AbConfigRow[];
      pairs: AbCasePair[];
      unpairedCaseIds: string[];
      /**
       * How many times each case ran on each side — the artifact's repetition
       * rows counted, not a flag echoed back.
       */
      repetitions: number;
    };

/**
 * Below this many repetitions per side, a case-level delta is not a measurement.
 *
 * A case's rate on one side moves in steps of 1/n, so at n = 1 the smallest
 * possible difference is the largest one the table can show: one model call
 * going the other way renders as ±100%. At n = 2 a single flip is still ±50%.
 * Three is the first count at which a case-level difference can be smaller than
 * a total reversal, which is the least a reader needs before a signed percentage
 * means anything. `--runs 1` is legal and is what the first live run used, so
 * this is the common case, not the edge one.
 */
export const NOISE_FLOOR_REPETITIONS = 3;

/** The rows one side owns. `rule` is the side id for this harness. */
function rowsForSide(cases: readonly ArtifactCase[], side: AbSideId): ArtifactCase[] {
  return cases.filter((entry) => entry.rule === side);
}

/** What a side's rows collectively say about one key. */
function valueForKey(rows: readonly ArtifactCase[], key: string): AbSideValue {
  if (rows.length === 0) return { kind: 'unrecorded' };
  const values = new Set<string>();
  let unsetOnSomeRows = false;
  for (const row of rows) {
    const delta = (row.configDeltas ?? []).find((entry) => entry.key === key);
    if (delta === undefined || delta.after === null) {
      unsetOnSomeRows = true;
      continue;
    }
    values.add(delta.after);
  }
  if (values.size === 0) return { kind: 'unset' };
  if (values.size === 1 && !unsetOnSomeRows) return { kind: 'set', value: [...values][0]! };
  return { kind: 'inconsistent', values: [...values].sort(), unsetOnSomeRows };
}

/** Order-independent identity of a side's value, for equality only. */
function valueIdentity(value: AbSideValue): string {
  return JSON.stringify(value);
}

/**
 * The configuration difference, derived from the two sides' `configDeltas`.
 *
 * Every key either side recorded appears, so an operator sees what was held
 * equal as well as what was varied; `differs` marks the ones the run is about.
 * This is the same comparison the engine prints from its plan (`configDiff` in
 * services/api/src/cli/discovery-ab.plan.ts), reconstructed from the artifact,
 * which is all a reader of a finished run has.
 */
export function deriveAbConfigDiff(cases: readonly ArtifactCase[]): AbConfigRow[] {
  const rows: Record<AbSideId, ArtifactCase[]> = { a: rowsForSide(cases, 'a'), b: rowsForSide(cases, 'b') };
  const keys = new Set<string>();
  for (const side of SIDE_IDS) {
    for (const row of rows[side]) {
      for (const delta of row.configDeltas ?? []) keys.add(delta.key);
    }
  }
  return [...keys].sort().map((key) => {
    const a = valueForKey(rows.a, key);
    const b = valueForKey(rows.b, key);
    return { key, a, b, differs: valueIdentity(a) !== valueIdentity(b) };
  });
}

/**
 * The case a `<case>/<side>/r<n>` row belongs to.
 *
 * The last segment is the repetition and the one before it is the side, which
 * equals the row's `rule` (`abSlotCaseId`,
 * services/api/src/cli/discovery-ab.main.ts). Both are stripped, so a case run
 * three times reads as one case with three repetitions rather than three cases.
 * A row that does not match that shape is not paired by guesswork — it is
 * reported unpaired, so a changed id scheme shows up as rows nobody could pair
 * rather than as rows silently dropped from the comparison.
 */
function caseIdOf(row: ArtifactCase): string | null {
  const parts = row.caseId.split('/');
  const sideIndex = parts.length - 2;
  if (sideIndex < 1) return null;
  if (parts[sideIndex] !== row.rule) return null;
  if (!/^r\d+$/.test(parts[parts.length - 1]!)) return null;
  return parts.slice(0, sideIndex).join('/');
}

/**
 * Folds one side's retrieval outcomes for one case across its repetitions.
 *
 * A row that carries neither field is left out of `recorded`: the harnesses that
 * do not measure retrieval write no such field, and inventing "not returned" for
 * them would report a miss that was never measured.
 */
function foldRetrieval(rows: readonly ArtifactCase[]): AbRetrieval {
  let recorded = false;
  const ranks: (number | null)[] = [];
  const evidenceTypes = new Set<string>();
  for (const row of rows) {
    if (!('targetRank' in row) && !('evidenceTypes' in row)) continue;
    recorded = true;
    const rank = row.targetRank ?? null;
    if (!ranks.includes(rank)) ranks.push(rank);
    for (const type of row.evidenceTypes ?? []) evidenceTypes.add(type);
  }
  // Ascending, with a recorded miss last: it is the worst outcome, not rank 0.
  ranks.sort((left, right) => {
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return left - right;
  });
  return { recorded, ranks, evidenceTypes: [...evidenceTypes].sort() };
}

/** Order-independent identity of a retrieval reading, for equality only. */
function retrievalIdentity(retrieval: AbRetrieval): string {
  return JSON.stringify([retrieval.ranks, retrieval.evidenceTypes]);
}

/** Folds one side's repetition rows for one case into a single reading. */
function foldRepetitions(rows: readonly ArtifactCase[]): AbSideCase {
  const runs = rows.reduce((total, row) => total + row.runs, 0);
  const passes = rows.reduce((total, row) => total + row.passes, 0);
  return {
    repetitions: rows.length,
    runs,
    passes,
    // Both formulas are the artifact schema's own
    // (packages/protocol/eval/shared/artifact.ts): a rate over zero runs is 0,
    // and flaky means some repetitions passed and some did not.
    passRate: runs === 0 ? 0 : passes / runs,
    flaky: passes > 0 && passes < runs,
    retrieval: foldRetrieval(rows),
  };
}

function summarize(rows: readonly ArtifactCase[], id: AbSideId, statedPassRate: number): AbSideSummary {
  return {
    id,
    passRate: statedPassRate,
    caseCount: new Set(rows.map(caseIdOf).filter((caseId) => caseId !== null)).size,
    passes: rows.reduce((total, row) => total + row.passes, 0),
    runs: rows.reduce((total, row) => total + row.runs, 0),
  };
}

/**
 * Reads a discovery-ab artifact as two sides and the difference between them.
 *
 * Returns `no-verdict` rather than a comparison whenever the artifact does not
 * support one: incomplete execution evidence (the engine's own exit-3 outcome,
 * "A comparison with one side missing is not a comparison"), an artifact that
 * predates execution evidence entirely, or one that does not hold both sides.
 */
export function deriveAbView(artifact: Artifact): AbView {
  const cases = artifact.payload.cases;
  const config = deriveAbConfigDiff(cases);
  const unpairedCaseIds = cases.filter((row) => caseIdOf(row) === null).map((row) => row.caseId);
  const completeness = artifact.completeness;

  if (completeness === undefined || completeness.complete === undefined) {
    return {
      kind: 'no-verdict',
      reason:
        'This artifact records no execution evidence, so whether both sides ran everything they were asked to '
        + 'cannot be established from it.',
      config,
      unpairedCaseIds,
    };
  }

  if (!completeness.complete) {
    const completed = completeness.completedRuns ?? 0;
    const requested = completeness.requestedRuns ?? 0;
    const failed = completeness.failedRuns ?? 0;
    return {
      kind: 'no-verdict',
      reason:
        `${completed} of ${requested} case-run(s) completed and ${failed} failed, so the two sides did not both `
        + 'run everything. A comparison with one side missing is not a comparison.',
      config,
      unpairedCaseIds,
    };
  }

  const rules = artifact.payload.rules ?? [];
  const stated: Partial<Record<AbSideId, number>> = {};
  for (const side of SIDE_IDS) {
    const rule = rules.find((entry) => entry.rule === side);
    if (rule !== undefined) stated[side] = rule.passRate;
  }
  const missing = SIDE_IDS.filter((side) => stated[side] === undefined);
  if (missing.length > 0) {
    return {
      kind: 'no-verdict',
      reason:
        `This artifact holds no side ${missing.join(' and no side ')}, so there is no pair to compare. `
        + 'A discovery A/B run files each side as a rule of its own.',
      config,
      unpairedCaseIds,
    };
  }

  const rows: Record<AbSideId, ArtifactCase[]> = { a: rowsForSide(cases, 'a'), b: rowsForSide(cases, 'b') };
  const byCase = new Map<string, Record<AbSideId, ArtifactCase[]>>();
  for (const side of SIDE_IDS) {
    for (const row of rows[side]) {
      const id = caseIdOf(row);
      if (id === null) continue;
      const entry = byCase.get(id) ?? { a: [], b: [] };
      entry[side].push(row);
      byCase.set(id, entry);
    }
  }

  const pairs: AbCasePair[] = [...byCase.entries()].map(([id, entry]) => {
    const a = entry.a.length > 0 ? foldRepetitions(entry.a) : null;
    const b = entry.b.length > 0 ? foldRepetitions(entry.b) : null;
    const comparable = a !== null && b !== null && a.runs > 0 && b.runs > 0;
    return {
      id,
      a,
      b,
      delta: comparable ? b!.passRate - a!.passRate : null,
      differs: comparable && a!.passRate !== b!.passRate,
      retrievalDiffers:
        comparable
        && a!.retrieval.recorded
        && b!.retrieval.recorded
        && retrievalIdentity(a!.retrieval) !== retrievalIdentity(b!.retrieval),
      flakySides: SIDE_IDS.filter((side) => (side === 'a' ? a : b)?.flaky === true),
    };
  });
  pairs.sort((left, right) => left.id.localeCompare(right.id));

  return {
    kind: 'comparison',
    sides: {
      a: summarize(rows.a, 'a', stated.a!),
      b: summarize(rows.b, 'b', stated.b!),
    },
    config,
    pairs,
    unpairedCaseIds,
    // Counted from the rows, because that is what was actually run: `--runs` is
    // not on the artifact (`buildAbArtifactMeta` pins the envelope's `runs` at 1
    // whatever it was). A complete run gives every case the same count, so the
    // largest is that count; a run where one is short is not complete and never
    // reaches here.
    repetitions: pairs.reduce(
      (most, pair) => Math.max(most, pair.a?.repetitions ?? 0, pair.b?.repetitions ?? 0),
      0,
    ),
  };
}
