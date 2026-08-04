import type { HarnessDescriptor, HarnessFlag, OpsHarness } from "./ops.types.js";

export const OPS_HARNESSES = [
  "matching",
  "profile",
  "premise",
  "opportunity",
  "discovery-ab",
] as const satisfies readonly OpsHarness[];

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

/**
 * discovery-ab's entire selection surface. Its parser accepts only --case,
 * --runs, --a, --b, --report and --force (services/api/src/cli/discovery-ab.ts
 * --help), so --rule, --tier, --no-judge, --alpha, --attempt-timeout-ms and
 * --strict-evidence are absent: offering a control the engine would reject is
 * the exact failure this harness exists to make visible.
 *
 * --runs is capped at AB_MAX_REPETITIONS (10), not the 25 the scorecard
 * harnesses allow, because the engine refuses anything higher before it spends
 * anything. registry.spec.ts pins the number against that constant's source.
 *
 * The engine does not *reject* a flag outside that set: parseAbRunArgs
 * (services/api/src/cli/discovery-ab.main.ts) scans argv for the flags it knows
 * and drops everything else. So a flag added to this list by mistake would not
 * fail the run — it would vanish, and the operator would get a run they did not
 * configure. renderRun is the last thing that can refuse it, and it refuses on
 * exactly this list, which is what registry.spec.ts pins.
 *
 * One control the server already emits and this engine already drops:
 * renderRun appends --no-save for an experimental profile (ops.argv.ts), and
 * discovery-ab ignores it. Harmless today — the server always passes --report,
 * abRunReportPath honours it, and this harness has no baseline or rolling run
 * history to poison — but it is a flag the site sends into a void, so whoever
 * gives discovery-ab a save path of its own owes it a real --no-save.
 */
const DISCOVERY_AB_FLAGS: readonly HarnessFlag[] = Object.freeze([
  { name: "runs", cli: "--runs", kind: "number", min: 1, max: 10, step: 1 },
  { name: "case", cli: "--case", kind: "string" },
]);

function descriptor(
  harness: OpsHarness,
  caseCount: number,
  question: string,
  detail: string,
  agents: readonly string[],
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
    agents: Object.freeze(agents),
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
    ["opportunityEvaluator"],
    [TIER_FLAG],
  ),
  profile: descriptor(
    "profile",
    8,
    "Did we build the right profile from what the user told us?",
    "Scores profile generation: extraction coverage, correct apply, and privacy boundaries.",
    ["profileGenerator"],
  ),
  premise: descriptor(
    "premise",
    10,
    "Did we break an intent into correct atomic premises?",
    "Scores the premise pipeline: decomposition atomicity and speech-act analysis.",
    ["premiseDecomposer", "premiseAnalyzer"],
  ),
  opportunity: descriptor(
    "opportunity",
    8,
    "Is the card text about a match any good?",
    "Scores the write-up shown to users: grounding, framing, tone, and no leaked evaluator reasoning.",
    ["opportunityPresenter"],
  ),
  /**
   * The one harness that is not a scorecard against a baseline, and the only
   * one that reads the environment flags this site can edit.
   *
   * `agents` is empty on purpose, and not because no model runs here: this
   * harness invokes the real discovery graph and loads an LLM judge, every one
   * of which resolves through EVAL_MODEL_OVERRIDES (model.config.ts). What is
   * true is narrower — the two SIDES never differ in models, only in
   * environment configuration — so a per-side model editor would be a control
   * that cannot change the comparison it appears to configure. Its per-side
   * surface is AB_FLAGS (services/api/src/cli/discovery-ab.flags.ts).
   *
   * An empty `agents` list does not mean the Launch page offers no model
   * control for this harness: its Config picker is gated on saved configs, not
   * on `agents`, and a saved config's models would reach the discovery graph.
   * That gap is recorded at the picker itself in apps/eval-ops Launch.tsx.
   */
  "discovery-ab": Object.freeze({
    harness: "discovery-ab",
    script: "eval:discovery-ab",
    // Its CLI and its package script both live in services/api, not here.
    cwd: "services/api",
    flags: DISCOVERY_AB_FLAGS,
    defaultRuns: 3,
    // HISTORICAL_MATRIX_CASES; pinned against the real corpus by
    // registry-corpus.spec.ts. One launched run executes every case on both
    // sides, so a run costs caseCount x runs x 2 graph invocations — see the
    // contract's own ceiling arithmetic, "5 cases x 10 repetitions x 2 sides"
    // (services/api/src/cli/discovery-ab.contract.ts).
    //
    // renderRun records that doubled number server-side (SIDES_PER_RUN in
    // ops.argv.ts). THE LAUNCH FORM STILL DOES NOT: apps/eval-ops Launch.tsx
    // multiplies caseCount x runs and doubles only when the operator ticks its
    // own unrelated A/B checkbox, so the pre-launch confirmation understates
    // this harness's spend by half until Task 5 (launch form) fixes it. A note
    // sits at that line too.
    caseCount: 5,
    // What the engine reports is two raw pass rates side by side
    // ("side a 4/15 (26.7%) vs side b 7/15 (46.7%)"), with no significance test
    // and no statement about which configuration is better; a slot passes on
    // five deterministic assertions plus a judge, of which returning the
    // expected person is one. The question therefore promises the comparison,
    // not a winner.
    question: "What pass rate does each of two discovery configurations reach on the same cases?",
    detail:
      "Runs the real discovery graph once per operator-chosen environment configuration over the same cases and emits one artifact holding both sides. There is no baseline \u2014 arbitrary configurations have none \u2014 so the pair is the result.",
    agents: Object.freeze([]),
  }),
});
