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
