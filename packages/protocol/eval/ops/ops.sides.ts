/**
 * What it means for a harness to compare two operator-supplied environment
 * configurations: which harnesses require a pair, what a pair costs, and every
 * reason a pair is refused.
 *
 * Lives in its own module for the same reason as ops.allowlist.ts: the browser
 * app imports these rules. The launch form has to refuse exactly what the server
 * refuses — a form that accepts a pair the server rejects turns a configuration
 * mistake into a 400 after the operator has committed to a spend — and it has to
 * price a run exactly as the server records it. Keeping the rules in ops.argv.ts
 * would have made that import pull zod (and RunSpecSchema's module-level schema
 * construction, which no bundler can drop) into the SPA: 67 kB for a function
 * that needs none of it.
 *
 * So this module must stay dependency-free (no node built-ins, no zod), exactly
 * like ops.allowlist.ts and ops.metadata.ts. ops.argv.ts re-exports what it uses
 * so the server side keeps one import site.
 */

import { DISCOVERY_ENV_KEYS } from "./ops.allowlist.js";
import { HARNESS_ENV_KEYS } from "./ops.envcatalog.js";
import { envValueIssueForKey, modelMapBounds } from "./ops.metadata.js";
import type { AbSides, OpsHarness } from "./ops.types.js";

/**
 * Whether one run of this harness MAY compare two operator-supplied environment
 * configurations.
 *
 * "May", not "must": discovery measures one configuration when launched without
 * `sides` and compares two when launched with them. It was `REQUIRES_SIDES`
 * while a comparison was the only shape it had; a single run is now expressible
 * (spec §5), so requiring a pair would refuse the cheaper of the two runs.
 *
 * Exhaustive by type, so a second comparison harness has to state its answer
 * here rather than inherit "no" and silently accept a spec with nothing to
 * compare. The four scorecard harnesses score one configuration against a
 * committed baseline, so a second configuration would have nothing to mean —
 * for them `sides` remains inexpressible, not optional.
 */
export const SUPPORTS_SIDES: Readonly<Record<OpsHarness, boolean>> = Object.freeze({
  matching: false,
  profile: false,
  premise: false,
  opportunity: false,
  discovery: true,
});

/**
 * How many times one launched run passes over the selected corpus.
 *
 * A function of the SPEC, not of the harness, because discovery has two shapes
 * and they cost different amounts: a pair runs every case twice in one
 * invocation (its contract prices its ceiling as "5 cases x 10 repetitions x
 * 2 sides") while a single run passes over the corpus once. A per-harness
 * constant — which this was, pinned at 2 for discovery — would now overstate a
 * single run by double.
 *
 * Read by `renderRun` (the number recorded on the run record) and by the launch
 * form (the number the operator authorises in the full-corpus confirmation).
 * Those two numbers must be the same number, so there is one of them. The site
 * shows it before spending, so a wrong number here is a lie about cost.
 */
export function sidesPerRun(spec: { harness: OpsHarness; sides?: AbSides }): number {
  return spec.sides === undefined ? 1 : SIDE_IDS.length;
}

export const SIDE_IDS = ["a", "b"] as const;

/**
 * Longest value a side may give a flag.
 *
 * Most offered flags need only a few characters — an enum token, an integer, or
 * a model name such as "google/gemini-2.5-flash-lite" (28). The exception is
 * EVAL_MODEL_OVERRIDES, which every catalogue offers and whose value is a JSON
 * agent-to-model map: one agent at the longest model id is 55 characters, and
 * all five overridable agents at that id is 259, which this cap REFUSES. That
 * refusal is deliberate and pre-flight — it names the key and the length — but
 * it does mean the largest expressible model map cannot be set per side. Raise
 * the cap rather than special-casing the key if that becomes a real need; the
 * value is not merely stored, it is recorded on the run record, rendered on
 * every page that shows the spec, and passed to Bun.spawn as an argv element,
 * where a megabyte-scale value would fail the whole exec with E2BIG rather than
 * being refused with a message. Matches the cap SelectionValueSchema already
 * puts on the other operator-supplied strings.
 */
const AB_SIDE_VALUE_MAX_LENGTH = 200;

/**
 * Characters that would make the engine's own parser refuse the assignment this
 * value renders into.
 *
 * `AB_ENV_ASSIGNMENT` in services/api/src/cli/discovery.main.ts is
 * /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/ — no `s` flag, so `.` matches no line
 * terminator and `$` (no `m` flag) anchors at the very end of the string. A
 * value carrying one of these therefore renders argv the engine rejects with
 * "--a expects KEY=VALUE", after the run has been queued and displayed. The
 * keys need no equivalent check: DISCOVERY_ENV_KEYS membership is asserted
 * first, and every catalogued key is SCREAMING_SNAKE, which matches the key
 * half by construction.
 */
const LINE_TERMINATORS = /[\n\r\u2028\u2029]/;

/**
 * Offered keys whose read site THROWS on a value it does not recognise, rather
 * than warning and using its own default.
 *
 * Every other catalogued flag is read by a parser that falls back — that is the
 * whole reason values are checked here before a run is queued, since a fallback
 * turns a reported difference into one that never happened. EVAL_MODEL_OVERRIDES
 * is the exception: `readModelOverrides` throws on invalid JSON, a non-object,
 * an unknown agent key and a blank model id
 * (src/shared/agent/model.config.ts:54-69, and ENV_FLAG_METADATA's json-model-map
 * docblock says so). The refusal text differs accordingly.
 */
const THROWING_ENV_KEYS: readonly string[] = Object.freeze(["EVAL_MODEL_OVERRIDES"]);

/** One refusal, with the path inside `sides` it belongs to. */
export interface AbSideIssue {
  /** Relative to `sides`: `[]`, `[sideId]` or `[sideId, key]`. */
  path: ("a" | "b" | string)[];
  message: string;
}

/**
 * Every reason the engine would refuse ONE side's configuration: key
 * membership, non-blank, length, line terminators and the value's real meaning.
 *
 * Extracted from {@link abSideIssues} so a single discovery run gets exactly the
 * per-side checks a pair gets. The pair-only rules — symmetry and distinctness —
 * are deliberately NOT here: they compare two sides and are meaningless for one.
 * Re-implementing these five for the single shape is how the two shapes would
 * come to disagree about what a value means, so there is one copy.
 */
function sideConfigIssues(
  config: Record<string, string>,
  id: string,
  label: string,
  offered: readonly string[] = DISCOVERY_ENV_KEYS,
  // Names the harness in the unreadable-key refusal. Defaulted to the discovery
  // graph because that is the only caller whose offered list is
  // DISCOVERY_ENV_KEYS; a per-harness caller passes its own name, since "not
  // readable by the discovery graph" is false when the harness is `matching`.
  reader = "the discovery graph",
): AbSideIssue[] {
  const issues: AbSideIssue[] = [];
  for (const key of Object.keys(config).sort()) {
    if (!offered.includes(key)) {
      issues.push({ path: [id, key], message: `${key} is not readable by ${reader}; this harness cannot test it` });
      continue;
    }
    const value = config[key]!;
    if (value.trim() === "") {
      issues.push({ path: [id, key], message: `${key} has an empty value${label}; unset it instead of blanking it` });
      continue;
    }
    if (value.length > AB_SIDE_VALUE_MAX_LENGTH) {
      issues.push({
        path: [id, key],
        message: `${key}${label} is ${value.length} characters; no flag this harness offers takes a value longer than ${AB_SIDE_VALUE_MAX_LENGTH}`,
      });
      continue;
    }
    if (LINE_TERMINATORS.test(value)) {
      issues.push({
        path: [id, key],
        message:
          `${key}${label} contains a line break; the engine's KEY=VALUE parser would refuse the argv `
          + `this renders, after the run had been queued`,
      });
      continue;
    }
    // The value's meaning, not just its shape. Every read site in the discovery
    // graph falls back rather than failing on a value it does not recognise, so
    // an unchecked typo does not stop the run: it runs the DEFAULT and reports
    // results under the value the operator named. Same rule the saved-config and
    // ad-hoc paths use (validateProfileEnv), by construction — both call
    // envValueIssueForKey WITH the same bounds. Passing none would silence the
    // whole check for EVAL_MODEL_OVERRIDES, whose bounds are its entire rule.
    const unreal = envValueIssueForKey(key, value, modelMapBounds());
    if (unreal !== null) {
      // The consequence sentence is per-key, because the two consequences are
      // opposite and an operator acts on them differently. Most read sites in
      // the discovery graph fall back, so a typo runs the DEFAULT under the
      // operator's label. EVAL_MODEL_OVERRIDES does not: readModelOverrides
      // THROWS on an unknown agent, a non-object and a blank model id
      // (src/shared/agent/model.config.ts:59-69), which is why ENV_FLAG_METADATA
      // gives it its own `json-model-map` kind. Telling an operator their value
      // would "fall back to the default" when it will in fact kill the run after
      // the branch reset is the same class of false sentence this check exists
      // to prevent, one layer over.
      issues.push({
        path: [id, key],
        message:
          `${key}="${value}"${label} ${unreal}. `
          + (THROWING_ENV_KEYS.includes(key)
            ? `This value is not honoured with a fallback: the run would fail at startup, after the branch reset`
            : `The discovery graph falls back to its own default for a value it does not recognise, so this `
              + `run would use the default while the report named your value`),
      });
    }
  }
  return issues;
}

/**
 * Every reason the engine would refuse a SINGLE discovery configuration.
 *
 * The single-run counterpart of {@link abSideIssues}. Same per-key rules, none
 * of the pair rules: there is no other side for a key to be symmetric with, and
 * nothing for the configuration to be distinct from. The one shared rule that
 * survives is "at least one flag", because a run configuring nothing is a run
 * measuring the committed default, which the engine refuses (`parseAbSideConfig`
 * in services/api/src/cli/discovery.main.ts throws when a shape names no key).
 *
 * `models` is the second half of the same question, not a courtesy. A model
 * selection is not a sibling of the env block: `resolveProfile` folds a
 * non-empty `models` into `EVAL_MODEL_OVERRIDES`, which every catalogue offers,
 * so a run selecting only models DOES configure something the harness reads.
 * Judging emptiness on `env` alone made the two layers disagree about one run —
 * `RunSpecSchema` refused an ad-hoc `{models:{...}, env:{}}` with "set at least
 * one flag the discovery graph reads" while the resolved path accepted the same
 * selection, and the refusal was false in its own terms because the accepted
 * path proves the graph reads it. Callers that have already resolved a profile
 * pass the folded env and omit `models`; callers holding an unresolved override
 * pass both.
 */
export function singleConfigIssues(
  config: Record<string, string>,
  models: Record<string, string> = {},
): AbSideIssue[] {
  if (Object.keys(config).length === 0 && Object.keys(models).length === 0) {
    return [{
      path: [],
      message: "This run has no configuration; set at least one flag the discovery graph reads, or there is nothing to measure",
    }];
  }
  return sideConfigIssues(config, "a", "").map((issue) => ({ ...issue, path: issue.path.slice(1) }));
}

/**
 * Every reason a resolved configuration would be refused ON THIS HARNESS,
 * per key. No emptiness rule: an empty configuration is a legitimate run
 * everywhere except the sides-capable harness, whose own rule is
 * {@link singleConfigIssues}.
 *
 * Exists because the per-key rules are NOT discovery-specific but
 * `singleConfigIssues` is: it checks membership against DISCOVERY_ENV_KEYS, so
 * asking it about a `matching` config that legitimately sets
 * SMARTEST_VERIFIER_MODEL (which matching reads and discovery does not) answers
 * "not readable by the discovery graph" — a refusal that is false on its face
 * and would block a legal run.
 *
 * The launch form calls this on a config it has resolved the way the server
 * does, because the server judges a config AFTER `resolveProfile` folds
 * `models` into EVAL_MODEL_OVERRIDES, and that folded value is subject to every
 * per-key rule including the length cap: five overridable agents at the longest
 * model id is 259 characters, which the cap refuses. Before this existed, such
 * a config was savable, enabled Run, took the spend confirmation and collected
 * a 400.
 *
 * Membership is checked against THIS harness's catalogue, so a key the harness
 * does read is never called unreadable. Callers that have already narrowed with
 * `readableEnv` pass a config in which every key is offered by construction;
 * the check still runs, because a caller that has not narrowed is the case it
 * exists to catch.
 */
export function configValueIssuesFor(harness: OpsHarness, config: Record<string, string>): AbSideIssue[] {
  // A harness with no catalogue in THIS build is reachable from the browser:
  // the harness list arrives from the server, which may be running a newer set.
  // Returning no issues rather than throwing keeps an unknown harness a
  // question for the server to answer, which is what every other per-harness
  // lookup on that page does.
  const offered = HARNESS_ENV_KEYS[harness] as readonly string[] | undefined;
  if (offered === undefined) return [];
  return sideConfigIssues(config, "a", "", offered, `the ${harness} harness`).map((issue) => ({
    ...issue,
    path: issue.path.slice(1),
  }));
}

/**
 * Every reason the engine would refuse this pair, checked before a run is queued.
 *
 * A mirror of `buildAbPlan` and `assertAbEnvConfig`
 * (services/api/src/cli/discovery.plan.ts, discovery.flags.ts), and the
 * single definition of those rules on this side of the boundary: `RunSpecSchema`
 * turns each issue into a validation error, `renderRun` throws the first, and the
 * launch form renders them beside the controls that produced them, so none of
 * the three can disagree about what is acceptable.
 *
 * Mirroring rather than delegating is forced — the engine's modules import
 * node:fs and this one is bundled for the browser — and the reason it is worth
 * doing is that the engine refuses these late: `parseAbRunArgs` ignores what it
 * does not recognise, and `buildAbPlan` runs only after the harness has loaded
 * its eval modules, so an unmirrored refusal costs the operator a run that dies
 * seconds in with nothing rendered on the page they launched from.
 *
 * Stricter than the engine in one direction, deliberately: `assertAbEnvConfig`
 * checks that a value is non-blank and nothing more, so it accepts a value the
 * discovery graph will not honour — every read site there falls back rather than
 * failing. A fallback on one side turns the artifact's `configDiff` into a
 * difference that did not exist at runtime, which is the one outcome an A/B run
 * must never produce, so the value is checked against the flag's real read site
 * here (`envValueIssueForKey`) before the run is queued.
 *
 * Deliberately NOT mirrored, because they are not expressible here: side
 * ordering (`assertOrderedDistinctSides`) cannot be violated by an `AbSides`
 * object, which has exactly one `a` and one `b`; and the engine's
 * "at least one case" and repetition-count checks belong to the selection
 * flags, which `RunFlagsSchema` and HARNESS_REGISTRY already bound.
 */
export function abSideIssues(sides: AbSides): AbSideIssue[] {
  const issues: AbSideIssue[] = [];

  for (const id of SIDE_IDS) {
    const config = sides[id];
    if (Object.keys(config).length === 0) {
      issues.push({
        path: [id],
        message: `Side ${id} has no configuration; each side must set at least one flag the discovery graph reads`,
      });
      continue;
    }
    issues.push(...sideConfigIssues(config, id, ` on side ${id}`));
  }

  // Symmetry. An omitted flag takes the graph's own default, and that default can
  // equal the other side's explicit value — so an asymmetric pair can measure
  // nothing at all while attributing whatever noise it finds to that flag.
  for (const [id, other] of [["a", "b"], ["b", "a"]] as const) {
    for (const key of Object.keys(sides[id]).sort()) {
      if (Object.prototype.hasOwnProperty.call(sides[other], key)) continue;
      issues.push({
        path: [id, key],
        message:
          `${key} is set on side ${id} but omitted on side ${other}; an omitted flag takes the graph's own `
          + `default, which may equal side ${id}'s value and make the run measure nothing. State ${key} `
          + `explicitly on both sides so the comparison is explicit versus explicit`,
      });
    }
  }

  // Distinctness. Identical sides spend real branch resets and live graph calls
  // to measure noise.
  const keys = new Set([...Object.keys(sides.a), ...Object.keys(sides.b)]);
  if (![...keys].some((key) => sides.a[key] !== sides.b[key])) {
    issues.push({ path: [], message: "Both sides have identical configurations; the run would measure noise, not a difference" });
  }

  return issues;
}
