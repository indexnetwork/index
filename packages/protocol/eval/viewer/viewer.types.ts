/** Privacy-safe, adapter-projected data consumed by the eval artifact viewer. */

export type ViewerCaseState = "pass" | "fail" | "flaky" | "unjudged" | "incomplete";
export type ViewerDeltaState = "improved" | "regressed" | "unchanged" | "new";

/** Digest-only provenance for an input file. Paths are intentionally excluded. */
export interface ViewerSourceSummary {
  sha256: string;
  byteLength: number;
}

/** A deliberately selected label/value pair safe for public display. */
export interface ViewerField {
  label: string;
  value: string;
}

/** Baseline comparison for a rate-bearing value. */
export interface ViewerDelta {
  before: number | null;
  after: number;
  change: number | null;
  state: ViewerDeltaState;
}

/** A single allowlisted assertion outcome from a scored run. */
export interface ViewerCheck {
  kind: string;
  passed: boolean;
}

/** Scored-output diagnostics, distinct from v2 provider execution attempts. */
export interface ViewerRunDiagnostic {
  /** One-based requested run slot that produced this scored output. */
  run: number;
  passed: boolean;
  checks: ViewerCheck[];
}

/** Allowlisted structural metadata for one v2 provider invocation attempt. */
export interface ViewerAttemptDiagnostic {
  attemptId: string;
  attemptNumber: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  outcome: "success" | "failure" | "timeout" | "cancelled";
  retryable: boolean;
  backoffMs: number;
}

/** Allowlisted structural metadata for one requested v2 run slot. */
export interface ViewerExecutionRunDiagnostic {
  runId: string;
  run: number;
  outcome: "success" | "failed" | "cancelled";
  recovered: boolean;
  attempts: ViewerAttemptDiagnostic[];
}

/** Rule/task-kind rollup shown by filters and the summary table. */
export interface ViewerRule {
  id: string;
  itemCount: number;
  passRate: number | null;
  delta?: ViewerDelta;
}

/** One paginated case or blind public item. */
export interface ViewerItem {
  id: string;
  group: string;
  state: ViewerCaseState;
  runs?: number;
  passes?: number;
  passRate?: number;
  delta?: ViewerDelta;
  fields: ViewerField[];
  diagnostics: ViewerRunDiagnostic[];
  diagnosticsAvailable: boolean;
  executionRuns: ViewerExecutionRunDiagnostic[];
  executionAvailable: boolean;
}

/** Structured shared-artifact identity used only for safe baseline compatibility checks. */
export interface ViewerSharedComparisonIdentity {
  artifactKind: "baseline" | "run-report";
  artifactSchemaVersion: 1 | 2;
  harness: string;
  harnessVersion: string;
  fullCorpus: boolean;
  corpusFingerprint: string;
  /** Null for v1, whose execution completeness was not recorded. */
  executionComplete: boolean | null;
}

/** Optional comparison against an explicitly supplied compatible baseline. */
export interface ViewerBaselineSummary {
  source: ViewerSourceSummary;
  aggregate: ViewerDelta;
  compatibility: "known-corpus-match" | "legacy-baseline-unverified";
  notice: string;
  missingItemIds: string[];
}

/** The only data shape permitted to cross from an adapter into HTML rendering. */
export interface ViewerDocument {
  viewerSchemaVersion: 1;
  kind: "shared-scorecard-v1" | "shared-scorecard-v2" | "hyde-public-blind-batch";
  adapterId: string;
  title: string;
  source: ViewerSourceSummary;
  artifact: ViewerField[];
  provenance: ViewerField[];
  completeness: ViewerField[];
  summary: ViewerField[];
  aggregatePassRate: number | null;
  sharedComparison?: ViewerSharedComparisonIdentity;
  rules: ViewerRule[];
  items: ViewerItem[];
  telemetryNotice?: string;
  baseline?: ViewerBaselineSummary;
}

/** Context supplied to every explicit presentation adapter. */
export interface ViewerAdapterContext {
  source: ViewerSourceSummary;
}

/** Explicit adapter contract. Arbitrary JSON never reaches the renderer. */
export interface ViewerAdapter {
  id: string;
  artifactType: string;
  harness?: string;
  schemaVersion: string | number;
  harnessVersion?: string;
  /** Source field names intentionally omitted by this adapter. */
  sensitiveFields: readonly string[];
  adapt(value: unknown, context: ViewerAdapterContext): ViewerDocument;
}

export type ViewerFailureCode =
  | "malformed-input"
  | "unsupported-artifact"
  | "prohibited-artifact"
  | "incompatible-artifact"
  | "incompatible-baseline";

/** Error carrying only a stable, public-safe failure category and guidance. */
export class ViewerSafeError extends Error {
  readonly code: ViewerFailureCode;

  /**
   * Creates a sanitized viewer error.
   *
   * @param code - Stable failure category safe to display.
   * @param message - Public-safe guidance that must not include source values.
   */
  constructor(code: ViewerFailureCode, message: string) {
    super(message);
    this.name = "ViewerSafeError";
    this.code = code;
  }
}

/** Sanitized failure data rendered instead of partially interpreted content. */
export interface ViewerFailure {
  code: ViewerFailureCode;
  title: string;
  message: string;
  source?: ViewerSourceSummary;
}
