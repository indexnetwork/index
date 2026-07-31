import { z } from "zod";

import { HARNESS_REGISTRY, OPS_HARNESSES } from "./ops.registry.js";
import type { ResolvedProfile } from "./ops.profiles.js";
import type { EvalRunSpec, RunFlags } from "./ops.types.js";

const RunFlagsSchema = z
  .object({
    runs: z.number().int().min(1).max(25).optional(),
    case: z.string().min(1).max(200).optional(),
    rule: z.string().min(1).max(200).optional(),
    tier: z.number().int().min(1).max(4).optional(),
    noJudge: z.boolean().optional(),
    alpha: z.number().gt(0).lt(1).optional(),
    attemptTimeoutMs: z.number().int().min(1_000).max(600_000).optional(),
    strictEvidence: z.boolean().optional(),
  })
  .strict();

/**
 * The only shape the API accepts from a client. Destructive flags are not
 * expressible here and are absent from HARNESS_REGISTRY, so no request can
 * produce them, and the fixture-reset variant of RunSpec is deliberately not
 * parseable here: a reset can only be created by the guarded fixture route.
 */
export const RunSpecSchema = z
  .object({
    kind: z.literal("eval"),
    harness: z.enum(OPS_HARNESSES as unknown as [string, ...string[]]),
    profile: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    flags: RunFlagsSchema,
  })
  .strict()
  .superRefine((spec, context) => {
    const supported = new Set(HARNESS_REGISTRY[spec.harness as EvalRunSpec["harness"]].flags.map((f) => f.name));
    for (const name of Object.keys(spec.flags) as (keyof RunFlags)[]) {
      if (!supported.has(name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["flags", name],
          message: `The ${spec.harness} harness does not accept --${name}`,
        });
      }
    }
  }) as unknown as z.ZodType<EvalRunSpec>;

export interface RenderedRun {
  argv: string[];
  env: Record<string, string>;
  /** False when any selection flag narrows the corpus. */
  fullCorpus: boolean;
  /** cases x runs, for the pre-launch workload confirmation. */
  workload: number;
}

const SELECTION_FLAGS: readonly (keyof RunFlags)[] = ["case", "rule", "tier"];

/**
 * Renders a validated RunSpec into an argv array and a child environment.
 *
 * There is no shell: argv is passed to Bun.spawn as an array. Experimental
 * profiles are forced to --no-save so an experimental full-corpus run can never
 * land in eval/<harness>/runs/ and become rolling-baseline fuel for everyone.
 *
 * When the resolved profile declares model overrides, OPENROUTER_FALLBACK_MODEL
 * is pinned to "none" to prevent createFallbackModel from swapping the agent
 * onto a different model mid-run — which would corrupt the comparison the
 * experimental run exists to measure. The profile can override this pin by
 * explicitly setting OPENROUTER_FALLBACK_MODEL in its env block.
 */
export function renderRun(spec: EvalRunSpec, resolved: ResolvedProfile, reportPath: string): RenderedRun {
  if (resolved.profile.name !== spec.profile) {
    throw new Error(`Resolved profile "${resolved.profile.name}" does not match the requested profile "${spec.profile}"`);
  }
  const descriptor = HARNESS_REGISTRY[spec.harness];
  const byName = new Map(descriptor.flags.map((flag) => [flag.name, flag]));

  const argv = ["bun", "run", descriptor.script, "--"];
  for (const [name, value] of Object.entries(spec.flags) as [keyof RunFlags, unknown][]) {
    const flag = byName.get(name);
    if (flag === undefined) throw new Error(`The ${spec.harness} harness does not accept --${name}`);
    if (flag.kind === "boolean") {
      if (value === true) argv.push(flag.cli);
      continue;
    }
    argv.push(flag.cli, String(value));
  }
  argv.push("--report", reportPath);
  if (resolved.experimental) argv.push("--no-save");

  const env = { ...resolved.env };
  
  // Pin OPENROUTER_FALLBACK_MODEL=none when the profile overrides models, unless
  // the profile explicitly set it. Reason: for an experimental run that exists
  // precisely to measure a specific model, a silent fallback means the artifact
  // could record results produced by a DIFFERENT model than the one under test —
  // which would corrupt the comparison the whole feature exists to support.
  if (Object.keys(resolved.profile.models).length > 0 && !("OPENROUTER_FALLBACK_MODEL" in env)) {
    env.OPENROUTER_FALLBACK_MODEL = "none";
  }

  const fullCorpus = !SELECTION_FLAGS.some((name) => spec.flags[name] !== undefined);
  const runs = spec.flags.runs ?? descriptor.defaultRuns;
  const cases = fullCorpus ? descriptor.caseCount : 1;

  return { argv, env, fullCorpus, workload: cases * runs };
}
