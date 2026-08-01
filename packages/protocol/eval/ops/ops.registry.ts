import type { HarnessDescriptor, HarnessFlag, OpsHarness } from "./ops.types.js";

export const OPS_HARNESSES = ["matching", "profile", "premise", "opportunity"] as const satisfies readonly OpsHarness[];

const COMMON_FLAGS: readonly HarnessFlag[] = Object.freeze([
  { name: "runs", cli: "--runs", kind: "number", min: 1, max: 25, step: 1 },
  { name: "case", cli: "--case", kind: "string" },
  { name: "rule", cli: "--rule", kind: "string" },
  { name: "noJudge", cli: "--no-judge", kind: "boolean" },
  // alpha is gt(0).lt(1) on the server; 0.001..0.999 is the inclusive equivalent at step resolution.
  { name: "alpha", cli: "--alpha", kind: "number", min: 0.001, max: 0.999, step: 0.001 },
  { name: "attemptTimeoutMs", cli: "--attempt-timeout-ms", kind: "number", min: 1_000, max: 600_000, step: 1 },
  { name: "strictEvidence", cli: "--strict-evidence", kind: "boolean" },
]);

const TIER_FLAG: HarnessFlag = { name: "tier", cli: "--tier", kind: "number", min: 1, max: 4, step: 1 };

function descriptor(
  harness: OpsHarness,
  caseCount: number,
  question: string,
  detail: string,
  extra: readonly HarnessFlag[] = [],
): HarnessDescriptor {
  return Object.freeze({
    harness,
    script: `eval:${harness}`,
    flags: Object.freeze([...COMMON_FLAGS, ...extra]),
    defaultRuns: 3,
    caseCount,
    question,
    detail,
  });
}

/**
 * The single source of launchable harness capability. The launch form and argv
 * rendering both read this, so the UI cannot drift from what the CLI accepts.
 * Destructive flags (--update-baseline, --force) are deliberately absent: a flag
 * that is not here cannot be produced by any RunSpec.
 */
export const HARNESS_REGISTRY: Readonly<Record<OpsHarness, HarnessDescriptor>> = Object.freeze({
  matching: descriptor(
    "matching",
    40,
    "Should these two people be connected at all?",
    "Scores the match decision: relevance, identity rules, and penalties such as a known location mismatch.",
    [TIER_FLAG],
  ),
  profile: descriptor(
    "profile",
    8,
    "Did we build the right profile from what the user told us?",
    "Scores profile generation: extraction coverage, correct apply, and privacy boundaries.",
  ),
  premise: descriptor(
    "premise",
    10,
    "Did we break an intent into correct atomic premises?",
    "Scores the premise pipeline: decomposition atomicity and speech-act analysis.",
  ),
  opportunity: descriptor(
    "opportunity",
    8,
    "Is the card text about a match any good?",
    "Scores the write-up shown to users: grounding, framing, tone, and no leaked evaluator reasoning.",
  ),
});
