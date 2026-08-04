/**
 * Whether a harness would accept the flag VALUES a spec carries — not merely
 * their names.
 *
 * `HARNESS_REGISTRY` states each flag's real bounds per harness, and those
 * bounds are not all the same: discovery-ab caps `--runs` at 10
 * (AB_MAX_REPETITIONS) where the scorecard harnesses allow 25, and every
 * harness's `--alpha` starts at 0.001 where `RunFlagsSchema`'s shared
 * `gt(0)` accepts 0.0005. A schema that checked only flag NAMES therefore
 * authorised runs the engine refuses: `--runs 25` on discovery-ab parsed, was
 * queued, was displayed as "250 model invocations", and then died on
 * `--runs must not exceed 10` (discovery-ab.main.ts) — a late refusal, after
 * the operator had committed to the spend.
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

import type { HarnessFlag, HarnessFlagName, OpsHarness, RunFlags } from "./ops.types.js";

/** One refused flag value, named by the flag it belongs to. */
export interface FlagValueIssue {
  name: HarnessFlagName;
  message: string;
}

/** "between 1 and 10", or the half-open equivalent when only one bound exists. */
function boundPhrase(flag: HarnessFlag): string {
  if (flag.min !== undefined && flag.max !== undefined) return `between ${flag.min} and ${flag.max}`;
  if (flag.max !== undefined) return `no higher than ${flag.max}`;
  return `no lower than ${flag.min}`;
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
    const belowMin = flag.min !== undefined && value < flag.min;
    const aboveMax = flag.max !== undefined && value > flag.max;
    if (!belowMin && !aboveMax) continue;
    issues.push({
      name,
      message:
        `The ${harness} harness accepts ${flag.cli} ${boundPhrase(flag)}; ${value} is outside that range `
        + `and the harness itself would refuse it`,
    });
  }

  return issues;
}
