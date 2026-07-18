import { EVAL_ARTIFACT_SCHEMA_VERSION_V1, EVAL_ARTIFACT_SCHEMA_VERSION_V2, EVAL_LEGACY_UNAVAILABLE } from "../shared/artifact.js";
import type { ViewerDelta, ViewerDeltaState, ViewerDocument, ViewerExecutionRunDiagnostic, ViewerItem, ViewerRule, ViewerSharedComparisonIdentity } from "./viewer.types.js";
import { ViewerSafeError } from "./viewer.types.js";

const SHARED_ADAPTER_ID = /^shared-(matching|profile|premise|opportunity)-(baseline|run-report)-v(1|2)$/;

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function failIncompatibleBaseline(): never {
  throw new ViewerSafeError(
    "incompatible-baseline",
    "Baseline deltas require a full-corpus shared run report and baseline from the same harness, version, and compatible corpus; schema-v2 current reports must have complete execution.",
  );
}

function sharedIdentity(document: ViewerDocument): ViewerSharedComparisonIdentity {
  const match = SHARED_ADAPTER_ID.exec(document.adapterId);
  const identity = document.sharedComparison;
  if (!match || !identity) failIncompatibleBaseline();

  const adapterSchemaVersion = Number(match[3]);
  const expectedKind = `shared-scorecard-v${adapterSchemaVersion}`;
  const executionShapeIsValid = identity.artifactSchemaVersion === EVAL_ARTIFACT_SCHEMA_VERSION_V1
    ? identity.executionComplete === null
    : identity.artifactSchemaVersion === EVAL_ARTIFACT_SCHEMA_VERSION_V2
      && typeof identity.executionComplete === "boolean";
  if (
    document.viewerSchemaVersion !== 1
    || document.kind !== expectedKind
    || match[1] !== identity.harness
    || match[2] !== identity.artifactKind
    || adapterSchemaVersion !== identity.artifactSchemaVersion
    || identity.harnessVersion !== "1"
    || !executionShapeIsValid
    || (
      identity.artifactKind === "baseline"
      && identity.artifactSchemaVersion === EVAL_ARTIFACT_SCHEMA_VERSION_V2
      && identity.executionComplete !== true
    )
  ) {
    failIncompatibleBaseline();
  }
  return identity;
}

function delta(before: number | null, after: number): ViewerDelta {
  if (before === null) return { before: null, after, change: null, state: "new" };
  const rawChange = after - before;
  const change = Object.is(rawChange, -0) ? 0 : rawChange;
  const state: ViewerDeltaState = change > 0 ? "improved" : change < 0 ? "regressed" : "unchanged";
  return { before, after, change, state };
}

function requiredRate(rate: number | null | undefined): number {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) failIncompatibleBaseline();
  return rate;
}

function cloneRule(rule: ViewerRule, comparison?: ViewerDelta): ViewerRule {
  return {
    id: rule.id,
    itemCount: rule.itemCount,
    passRate: rule.passRate,
    ...(comparison ? { delta: comparison } : {}),
  };
}

function cloneExecutionRun(run: ViewerExecutionRunDiagnostic): ViewerExecutionRunDiagnostic {
  return {
    runId: run.runId,
    run: run.run,
    outcome: run.outcome,
    recovered: run.recovered,
    attempts: run.attempts.map((attempt) => ({
      attemptId: attempt.attemptId,
      attemptNumber: attempt.attemptNumber,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      durationMs: attempt.durationMs,
      outcome: attempt.outcome,
      retryable: attempt.retryable,
      backoffMs: attempt.backoffMs,
    })),
  };
}

function cloneItem(item: ViewerItem, comparison?: ViewerDelta): ViewerItem {
  return {
    id: item.id,
    group: item.group,
    state: item.state,
    ...(item.runs === undefined ? {} : { runs: item.runs }),
    ...(item.passes === undefined ? {} : { passes: item.passes }),
    ...(item.passRate === undefined ? {} : { passRate: item.passRate }),
    ...(comparison ? { delta: comparison } : {}),
    fields: item.fields.map((entry) => ({ ...entry })),
    diagnostics: item.diagnostics.map((diagnostic) => ({
      run: diagnostic.run,
      passed: diagnostic.passed,
      checks: diagnostic.checks.map((check) => ({ ...check })),
    })),
    diagnosticsAvailable: item.diagnosticsAvailable,
    executionRuns: item.executionRuns.map(cloneExecutionRun),
    executionAvailable: item.executionAvailable,
  };
}

function compatibleCorpus(current: ViewerSharedComparisonIdentity, baseline: ViewerSharedComparisonIdentity): boolean {
  return current.corpusFingerprint !== EVAL_LEGACY_UNAVAILABLE
    && (
      baseline.corpusFingerprint === EVAL_LEGACY_UNAVAILABLE
      || current.corpusFingerprint === baseline.corpusFingerprint
    );
}

/**
 * Adds aggregate, rule, and item deltas from a compatible shared baseline.
 * The input projections are never mutated. Current-only rules/items are marked
 * new; baseline-only item IDs are returned in the missing list.
 *
 * @param current - Shared run-report document being inspected.
 * @param baseline - Shared baseline projection for the same harness and harness version.
 * @returns A deeply cloned viewer document carrying deterministic comparison data.
 * @throws ViewerSafeError when identities, completeness, corpora, or rates are incompatible.
 */
export function compareViewerBaseline(current: ViewerDocument, baseline: ViewerDocument): ViewerDocument {
  const currentIdentity = sharedIdentity(current);
  const baselineIdentity = sharedIdentity(baseline);
  if (
    currentIdentity.artifactKind !== "run-report"
    || baselineIdentity.artifactKind !== "baseline"
    || currentIdentity.harness !== baselineIdentity.harness
    || currentIdentity.harnessVersion !== baselineIdentity.harnessVersion
    || !currentIdentity.fullCorpus
    || !baselineIdentity.fullCorpus
    || !compatibleCorpus(currentIdentity, baselineIdentity)
    || (
      currentIdentity.artifactSchemaVersion === EVAL_ARTIFACT_SCHEMA_VERSION_V2
      && currentIdentity.executionComplete !== true
    )
  ) {
    failIncompatibleBaseline();
  }

  const baselineRules = new Map(baseline.rules.map((rule) => [rule.id, rule]));
  const baselineItems = new Map(baseline.items.map((item) => [item.id, item]));
  if (baselineRules.size !== baseline.rules.length || baselineItems.size !== baseline.items.length) {
    failIncompatibleBaseline();
  }

  const rules = current.rules
    .map((rule) => {
      const before = baselineRules.get(rule.id);
      return cloneRule(rule, delta(before ? requiredRate(before.passRate) : null, requiredRate(rule.passRate)));
    })
    .sort((left, right) => compareAscii(left.id, right.id));

  const items = current.items
    .map((item) => {
      const before = baselineItems.get(item.id);
      return cloneItem(item, delta(before ? requiredRate(before.passRate) : null, requiredRate(item.passRate)));
    })
    .sort((left, right) => compareAscii(left.id, right.id));

  const currentItemIds = new Set(items.map((item) => item.id));
  const missingItemIds = baseline.items
    .map((item) => item.id)
    .filter((id) => !currentItemIds.has(id))
    .sort(compareAscii);

  return {
    viewerSchemaVersion: 1,
    kind: current.kind,
    adapterId: current.adapterId,
    title: current.title,
    source: { sha256: current.source.sha256, byteLength: current.source.byteLength },
    artifact: current.artifact.map((entry) => ({ ...entry })),
    provenance: current.provenance.map((entry) => ({ ...entry })),
    completeness: current.completeness.map((entry) => ({ ...entry })),
    summary: current.summary.map((entry) => ({ ...entry })),
    aggregatePassRate: requiredRate(current.aggregatePassRate),
    sharedComparison: { ...currentIdentity },
    rules,
    items,
    ...(current.telemetryNotice === undefined ? {} : { telemetryNotice: current.telemetryNotice }),
    baseline: {
      source: { sha256: baseline.source.sha256, byteLength: baseline.source.byteLength },
      aggregate: delta(requiredRate(baseline.aggregatePassRate), requiredRate(current.aggregatePassRate)),
      compatibility: baselineIdentity.corpusFingerprint === EVAL_LEGACY_UNAVAILABLE
        ? "legacy-baseline-unverified"
        : "known-corpus-match",
      notice: baselineIdentity.corpusFingerprint === EVAL_LEGACY_UNAVAILABLE
        ? "Descriptive only: the legacy baseline has no corpus fingerprint, so corpus compatibility could not be verified."
        : "Descriptive only: the corpus fingerprint matches; configuration, model, and judge equivalence are not asserted.",
      missingItemIds,
    },
  };
}

/**
 * Applies a compatible baseline comparison to a projected viewer document.
 *
 * @param current - Shared run-report document being inspected.
 * @param baseline - Shared baseline projection for the same harness.
 * @returns A new document with deterministic aggregate, rule, and item deltas.
 */
export function applyViewerBaseline(current: ViewerDocument, baseline: ViewerDocument): ViewerDocument {
  return compareViewerBaseline(current, baseline);
}
