import type { HarnessDescriptor, HarnessFlag, OpsHarness } from "./ops.types.js";

export const OPS_HARNESSES = ["matching", "profile", "premise", "opportunity"] as const satisfies readonly OpsHarness[];

const COMMON_FLAGS: readonly HarnessFlag[] = Object.freeze([
  { name: "runs", cli: "--runs", kind: "number" },
  { name: "case", cli: "--case", kind: "string" },
  { name: "rule", cli: "--rule", kind: "string" },
  { name: "noJudge", cli: "--no-judge", kind: "boolean" },
  { name: "alpha", cli: "--alpha", kind: "number" },
  { name: "attemptTimeoutMs", cli: "--attempt-timeout-ms", kind: "number" },
  { name: "strictEvidence", cli: "--strict-evidence", kind: "boolean" },
]);

const TIER_FLAG: HarnessFlag = { name: "tier", cli: "--tier", kind: "number" };

function descriptor(harness: OpsHarness, caseCount: number, extra: readonly HarnessFlag[] = []): HarnessDescriptor {
  return Object.freeze({
    harness,
    script: `eval:${harness}`,
    flags: Object.freeze([...COMMON_FLAGS, ...extra]),
    defaultRuns: 3,
    caseCount,
  });
}

/**
 * The single source of launchable harness capability. The launch form and argv
 * rendering both read this, so the UI cannot drift from what the CLI accepts.
 * Destructive flags (--update-baseline, --force) are deliberately absent: a flag
 * that is not here cannot be produced by any RunSpec.
 */
export const HARNESS_REGISTRY: Readonly<Record<OpsHarness, HarnessDescriptor>> = Object.freeze({
  matching: descriptor("matching", 40, [TIER_FLAG]),
  profile: descriptor("profile", 8),
  premise: descriptor("premise", 10),
  opportunity: descriptor("opportunity", 8),
});
