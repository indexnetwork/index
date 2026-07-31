/** The four harnesses that emit the shared scorecard artifact envelope. */
export type OpsHarness = "matching" | "profile" | "premise" | "opportunity";

export type HarnessFlagName =
  | "runs"
  | "case"
  | "rule"
  | "tier"
  | "noJudge"
  | "alpha"
  | "attemptTimeoutMs"
  | "strictEvidence";

export interface HarnessFlag {
  name: HarnessFlagName;
  /** The literal CLI flag, e.g. "--runs". */
  cli: string;
  kind: "number" | "string" | "boolean";
  /**
   * Numeric bounds mirroring RunFlagsSchema in ops.argv.ts, so a form built from
   * this registry cannot mark a server-valid value invalid (or vice versa).
   * Exclusive server bounds are expressed as the nearest representable value at
   * `step` resolution, because HTML min/max are inclusive.
   */
  min?: number;
  max?: number;
  step?: number;
}

export interface HarnessDescriptor {
  harness: OpsHarness;
  /** Package script name in packages/protocol/package.json, e.g. "eval:matching". */
  script: string;
  flags: readonly HarnessFlag[];
  defaultRuns: number;
  /** Corpus size, used to show workload (cases x runs) before launching. */
  caseCount: number;
}

export interface ArtifactRef {
  /** base64url of the path relative to eval/. Stable and addressable without a database. */
  id: string;
  harness: OpsHarness;
  kind: "baseline" | "run";
  /** Path relative to eval/. */
  path: string;
  schemaVersion: number;
  createdAt: string;
  models: string[];
  runs: number;
  selection: { fullCorpus: boolean; filters: Record<string, string> };
  git: { revision: string; dirty: boolean | null };
  corpusFingerprint: string;
  configFingerprint: string;
  aggregatePassRate: number;
  caseCount: number;
  /** True only for v2 artifacts that recorded complete execution evidence. */
  complete: boolean | null;
  sizeBytes: number;
  mtimeMs: number;
}

export interface IndexIssue {
  /** Path relative to eval/. */
  path: string;
  message: string;
}

export interface IndexResult {
  refs: ArtifactRef[];
  issues: IndexIssue[];
}

export interface RunFlags {
  runs?: number;
  case?: string;
  rule?: string;
  tier?: number;
  noJudge?: boolean;
  alpha?: number;
  attemptTimeoutMs?: number;
  strictEvidence?: boolean;
}

export interface EvalRunSpec {
  kind: "eval";
  harness: OpsHarness;
  /** Name of a committed profile. Never a set of raw overrides. */
  profile: string;
  flags: RunFlags;
}

/**
 * A guarded test-database reset. It is a run like any other so it streams live,
 * is logged and appears in run history. Only the database NAME is recorded: a
 * connection string never enters a record.
 */
export interface FixtureResetSpec {
  kind: "fixture-reset";
  personas: number;
  /** Always true: migrations are applied on every reset. Drift is never probed. */
  migrate: boolean;
  /** The database the operator confirmed by name. */
  databaseName: string;
}

export type RunSpec = EvalRunSpec | FixtureResetSpec;

export type RunStatus =
  | "queued"
  | "running"
  | "passed"
  | "regression"
  | "execution-error"
  | "insufficient-evidence"
  | "cancelled"
  | "interrupted"
  | "crashed";

/** One spawned command of a multi-step run, recorded for auditability. */
export interface RunStepRecord {
  label: string;
  argv: string[];
  /** Working directory, relative to the repository root. */
  cwd: string;
}

export interface RunRecord {
  id: string;
  spec: RunSpec;
  /**
   * The exact argv that was or will be spawned, recorded for auditability.
   * Empty for a multi-step run, which records `steps` instead.
   */
  argv: string[];
  /** The command sequence of a multi-step run. Absent for a single-command run. */
  steps?: RunStepRecord[];
  /** Injected environment. Never contains credentials. */
  env: Record<string, string>;
  profileFingerprint: string;
  experimental: boolean;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  pid: number | null;
  /** Path to the run report, relative to eval/, once the harness has written one. */
  artifactPath: string | null;
  workload: number;
}
