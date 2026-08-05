import type { HarnessDescriptor, HarnessFlag, OpsHarness } from "./ops.types.js";

export const OPS_HARNESSES = [
  "matching",
  "profile",
  "premise",
  "opportunity",
  "discovery",
] as const satisfies readonly OpsHarness[];

/**
 * Every numeric flag states two things (HarnessFlag in ops.types.ts): the bounds
 * its CONTROL offers (min/max/step, inclusive because HTML is) and the bounds
 * the API ENFORCES (`accepts`), with who holds each end.
 *
 * They are not the same thing, and conflating them refused runs the engines
 * accept. `--alpha` is the case that proves it: every engine takes any
 * 0 < alpha < 1 (`alpha <= 0 || alpha >= 1` in matching.eval.ts and the profile,
 * premise and opportunity equivalents), while a step-0.001 slider can only offer
 * 0.001..0.999. Enforcing the slider's approximation refused `--alpha 0.0005`
 * with the sentence "the harness itself would refuse it" — which the harness
 * contradicts. So the slider stays 0.001..0.999 and the authority is the real
 * exclusive 0..1.
 */
const COMMON_FLAGS: readonly HarnessFlag[] = Object.freeze([
  {
    name: "runs",
    cli: "--runs",
    kind: "number",
    min: 1,
    max: 25,
    step: 1,
    // The floor is the engines' (`--runs must be a positive integer`); the
    // ceiling is this site's alone (RunFlagsSchema), because a scorecard harness
    // has none — so 26 is refused here without claiming the harness would.
    accepts: { min: { value: 1, heldBy: "harness" }, max: { value: 25, heldBy: "site" } },
  },
  { name: "case", cli: "--case", kind: "string" },
  { name: "rule", cli: "--rule", kind: "string" },
  { name: "noJudge", cli: "--no-judge", kind: "boolean" },
  {
    name: "alpha",
    cli: "--alpha",
    kind: "number",
    min: 0.001,
    max: 0.999,
    step: 0.001,
    // Exactly the engines' own check, exclusive ends and all; RunFlagsSchema
    // says the same (gt(0).lt(1)), so 0 and 1 are refused and everything
    // strictly between them runs. registry.spec.ts reads the check from the
    // four harness sources rather than trusting this line.
    accepts: {
      min: { value: 0, exclusive: true, heldBy: "harness" },
      max: { value: 1, exclusive: true, heldBy: "harness" },
    },
  },
  {
    name: "attemptTimeoutMs",
    cli: "--attempt-timeout-ms",
    kind: "number",
    min: 1_000,
    max: 600_000,
    step: 1,
    // The engines ask only for a positive number, so both ends here are the
    // site's: 500ms and ten minutes are refusals this site makes on its own.
    accepts: { min: { value: 1_000, heldBy: "site" }, max: { value: 600_000, heldBy: "site" } },
  },
  { name: "strictEvidence", cli: "--strict-evidence", kind: "boolean" },
]);

const TIER_FLAG: HarnessFlag = {
  name: "tier",
  cli: "--tier",
  kind: "number",
  min: 1,
  max: 4,
  step: 1,
  // parseTier (matching.selection.ts) throws on anything but 1, 2, 3, 4.
  accepts: { min: { value: 1, heldBy: "harness" }, max: { value: 4, heldBy: "harness" } },
};

/**
 * discovery's entire selection surface. Its parser accepts only --case,
 * --runs, --a, --b, --report and --force (services/api/src/cli/discovery.ts
 * --help), so --rule, --tier, --no-judge, --alpha, --attempt-timeout-ms and
 * --strict-evidence are absent: offering a control the engine would reject is
 * the exact failure this harness exists to make visible.
 *
 * --runs is capped at AB_MAX_REPETITIONS (10), not the 25 the scorecard
 * harnesses allow, because the engine refuses anything higher before it spends
 * anything. registry.spec.ts pins the number against that constant's source,
 * and RunSpecSchema enforces it: the shared RunFlagsSchema bound is the union
 * across harnesses, so checking only flag NAMES against this list once let a
 * spec through that the form priced at 250 invocations and the engine then
 * refused with "--runs must not exceed 10" (flagValueIssues, ops.flags.ts).
 *
 * The engine does not *reject* a flag outside that set: parseAbRunArgs
 * (services/api/src/cli/discovery.main.ts) scans argv for the flags it knows
 * and drops everything else. So a flag added to this list by mistake would not
 * fail the run — it would vanish, and the operator would get a run they did not
 * configure. renderRun is the last thing that can refuse it, and it refuses on
 * exactly this list, which is what registry.spec.ts pins.
 *
 * The one argv this list does not cover is --no-save, which renderRun appends
 * for an experimental run (ops.argv.ts:261) — and this harness can never have
 * one. `experimental` is set by exactly two things: a profile whose name is not
 * "default" (ops.profiles.ts:81) and ad-hoc overrides (ops.profiles.ts:166).
 * Both are refused alongside `sides` by RunSpecSchema (ops.argv.ts:147-166) and
 * again by renderRun before anything is spent (ops.argv.ts:243-248), while
 * `sides` is mandatory here (REQUIRES_SIDES, ops.argv.ts:236-239). So no
 * discovery run reaches line 261 with `experimental` true, and the site never
 * sends this engine a flag it would drop.
 *
 * That is the only reason it does not matter that parseAbRunArgs would drop one:
 * the harness saves where --report says and nowhere else, so whoever later gives
 * discovery a rolling run history, or lets it run under a config, owes it a
 * real --no-save first.
 */
const DISCOVERY_FLAGS: readonly HarnessFlag[] = Object.freeze([
  {
    name: "runs",
    cli: "--runs",
    kind: "number",
    min: 1,
    max: 10,
    step: 1,
    // Both ends are the engine's: parseAbRunArgs refuses a non-positive count
    // and anything above AB_MAX_REPETITIONS, before it spends anything.
    accepts: { min: { value: 1, heldBy: "harness" }, max: { value: 10, heldBy: "harness" } },
  },
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
   * surface is AB_FLAGS (services/api/src/cli/discovery.flags.ts).
   *
   * An empty `agents` list is not on its own enough to keep models off the
   * page: the Launch form's Config picker is gated on saved configs, not on
   * `agents`, and a saved config's models WOULD reach the discovery graph. So
   * the form does not render that picker for a harness that carries sides, and
   * says on the page why (apps/eval-ops Launch.tsx).
   */
  discovery: Object.freeze({
    harness: "discovery",
    script: "eval:discovery",
    // Its CLI and its package script both live in services/api, not here.
    cwd: "services/api",
    flags: DISCOVERY_FLAGS,
    defaultRuns: 3,
    // HISTORICAL_MATRIX_CASES; pinned against the real corpus by
    // registry-corpus.spec.ts. One launched run executes every case on both
    // sides, so a run costs caseCount x runs x 2 graph invocations — see the
    // contract's own ceiling arithmetic, "5 cases x 10 repetitions x 2 sides"
    // (services/api/src/cli/discovery.contract.ts).
    //
    // Both the number recorded on the run record and the number the operator
    // confirms before launching read one constant: SIDES_PER_RUN in
    // ops.sides.ts, used by renderRun (ops.argv.ts) and by the launch form
    // (apps/eval-ops Launch.tsx). They cannot disagree about what a run costs.
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
    // Every run of this harness resets the two Neon evaluation branches before
    // each side, filtered or not: --case narrows what is measured, not what is
    // destroyed. The launch form quotes this in its confirmation, which is the
    // last moment anyone can decline it — and quotes it from here, because the
    // form branches on REQUIRES_SIDES and must not attribute this harness's
    // destruction to some later comparison harness that does not do it.
    resets: "both Neon evaluation branches",
    agents: Object.freeze([]),
  }),
});
