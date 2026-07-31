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
