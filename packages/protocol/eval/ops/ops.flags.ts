/**
 * Whether a harness would accept the flag VALUES a spec carries — not merely
 * their names.
 *
 * `HARNESS_REGISTRY` states each flag's real bounds per harness, and those
 * bounds are not all the same: discovery caps `--runs` at 10
 * (AB_MAX_REPETITIONS) where the scorecard harnesses do not cap it at all. A
 * schema that checked only flag NAMES therefore authorised runs the engine
 * refuses: `--runs 25` on discovery parsed, was queued, was displayed as
 * "250 model invocations", and then died on `--runs must not exceed 10`
 * (discovery.main.ts) — a late refusal, after the operator had committed to
 * the spend.
 *
 * What is checked is `flag.accepts` — the API bounds — and never the control
 * bounds a form puts on an input. The two differ where a control cannot express
 * what the engine takes: `--alpha` is offered at step 0.001 as 0.001..0.999,
 * and enforcing THAT refused `--alpha 0.0005`, which every engine runs
 * (`alpha <= 0 || alpha >= 1`). A control's resolution is not a rule.
 *
 * Each bound also records who holds it, and the refusal says only what is true
 * of that holder: the engine's own limits are reported as the harness refusing
 * the value, this site's shared ceiling is reported as this site refusing it.
 * A refusal that told an operator "the harness itself would refuse it" about a
 * value the harness accepts is a false sentence in the one place a false
 * sentence costs the most.
 *
 * So the bounds are checked here, once, by a function both sides call:
 * `RunSpecSchema` and `renderRun` on the server, and the launch form in the
 * browser, which passes the descriptor the server sent it. A form that cannot
 * derive its own answer cannot come to disagree with the launch.
 *
 * Dependency-free by contract (no node built-ins, no zod), because the browser
 * bundle imports it — the same rule ops.allowlist.ts, ops.metadata.ts and
 * ops.sides.ts keep, pinned by argv.spec.ts.
 */

import type { FlagBound, HarnessFlag, HarnessFlagName, OpsHarness, RunFlags } from "./ops.types.js";

/** One refused flag value, named by the flag it belongs to. */
export interface FlagValueIssue {
  name: HarnessFlagName;
  message: string;
}

/**
 * What the API accepts for this flag. A flag that declares nothing falls back to
 * its control bounds held by the site, which is the one attribution that cannot
 * be wrong: a refusal from this function IS the site refusing the value.
 */
function acceptedBounds(flag: HarnessFlag): { min?: FlagBound; max?: FlagBound } {
  if (flag.accepts !== undefined) return flag.accepts;
  return {
    ...(flag.min === undefined ? {} : { min: { value: flag.min, heldBy: "site" as const } }),
    ...(flag.max === undefined ? {} : { max: { value: flag.max, heldBy: "site" as const } }),
  };
}

const lowPhrase = (bound: FlagBound): string =>
  bound.exclusive ? `above ${bound.value}` : `no lower than ${bound.value}`;
const highPhrase = (bound: FlagBound): string =>
  bound.exclusive ? `below ${bound.value}` : `no higher than ${bound.value}`;

/**
 * The range as the holder of the violated bound states it: "between 1 and 10",
 * "above 0 and below 1", "no higher than 25".
 *
 * Only the ends this holder actually holds are described, because the sentence
 * is attributed to that holder. `--runs` on a scorecard harness is the case:
 * the floor is the engine's and the ceiling is this site's, so "the matching
 * harness accepts --runs between 1 and 25" would be false — the harness would
 * run 26. It reads "no lower than 1" instead, which is exactly what the engine
 * holds.
 */
function boundPhrase(bounds: { min?: FlagBound; max?: FlagBound }, heldBy: FlagBound["heldBy"]): string {
  const min = bounds.min?.heldBy === heldBy ? bounds.min : undefined;
  const max = bounds.max?.heldBy === heldBy ? bounds.max : undefined;
  if (min !== undefined && max !== undefined) {
    if (min.exclusive !== true && max.exclusive !== true) return `between ${min.value} and ${max.value}`;
    return `${lowPhrase(min)} and ${highPhrase(max)}`;
  }
  if (max !== undefined) return highPhrase(max);
  if (min !== undefined) return lowPhrase(min);
  // Unreachable: `heldBy` is read off a bound that was just violated.
  return "a value it declares";
}

/** The one bound this value is outside, or undefined when it is inside both. */
function violatedBound(bounds: { min?: FlagBound; max?: FlagBound }, value: number): FlagBound | undefined {
  const { min, max } = bounds;
  if (min !== undefined && (min.exclusive === true ? value <= min.value : value < min.value)) return min;
  if (max !== undefined && (max.exclusive === true ? value >= max.value : value > max.value)) return max;
  return undefined;
}

/**
 * Every reason this harness would refuse these flags: a flag it does not have,
 * or a numeric value outside the bounds it declares.
 *
 * Only numbers are range-checked; a value of the wrong TYPE is `RunSpecSchema`'s
 * business, and reporting it twice would put two different sentences about one
 * mistake on the page.
 */
export function flagValueIssues(
  harness: OpsHarness,
  flags: readonly HarnessFlag[],
  values: Readonly<RunFlags>,
): FlagValueIssue[] {
  const byName = new Map(flags.map((flag) => [flag.name, flag]));
  const issues: FlagValueIssue[] = [];

  for (const [name, value] of Object.entries(values) as [HarnessFlagName, unknown][]) {
    if (value === undefined) continue;
    const flag = byName.get(name);
    if (flag === undefined) {
      // Same sentence the schema has always used for an unsupported flag; the
      // form shows it now too rather than only the server seeing it.
      issues.push({ name, message: `The ${harness} harness does not accept --${name}` });
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const bounds = acceptedBounds(flag);
    const violated = violatedBound(bounds, value);
    if (violated === undefined) continue;
    const phrase = boundPhrase(bounds, violated.heldBy);
    issues.push({
      name,
      message:
        violated.heldBy === "harness"
          ? `The ${harness} harness accepts ${flag.cli} ${phrase}; ${value} is outside that range `
            + `and the harness itself would refuse it`
          : `This site accepts ${flag.cli} ${phrase}; ${value} is outside that range`,
    });
  }

  return issues;
}
