import { z } from "zod";

import { HARNESS_REGISTRY, OPS_HARNESSES } from "./ops.registry.js";
import { REQUIRES_SIDES, SIDES_PER_RUN, SIDE_IDS, abSideIssues } from "./ops.sides.js";
import type { ResolvedProfile } from "./ops.profiles.js";
import type { EvalRunSpec, RunFlags } from "./ops.types.js";

/**
 * The per-side rules live in ops.sides.ts, which is dependency-free so the
 * launch form can import the very same definitions (this module's zod schemas
 * cannot be tree-shaken out of a browser bundle). Re-exported here because this
 * is where the server reads them from.
 */
export { REQUIRES_SIDES, SIDES_PER_RUN, abSideIssues, type AbSideIssue } from "./ops.sides.js";

/**
 * A selection-flag value becomes its own argv element, so a value like
 * "--update-baseline" would arrive at the harness's parser looking exactly like a
 * flag. No shell is involved and no harness is known to mis-parse it, but this
 * schema is the trust boundary: a value that can be read as a flag never crosses it.
 */
const SelectionValueSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !value.startsWith("-"), { message: "must not begin with \"-\"" });

const RunFlagsSchema = z
  .object({
    runs: z.number().int().min(1).max(25).optional(),
    case: SelectionValueSchema.optional(),
    rule: SelectionValueSchema.optional(),
    tier: z.number().int().min(1).max(4).optional(),
    noJudge: z.boolean().optional(),
    alpha: z.number().gt(0).lt(1).optional(),
    attemptTimeoutMs: z.number().int().min(1_000).max(600_000).optional(),
    strictEvidence: z.boolean().optional(),
  })
  .strict();

/**
 * One side's configuration as it arrives on the wire.
 *
 * The `__proto__` check runs before `z.record`, because it is the only place it
 * can: `JSON.parse` gives the key as an ordinary own property, and zod's record
 * copies entries onto a fresh object with assignment, which for `__proto__`
 * hits Object.prototype's setter and DROPS it. The key would then vanish
 * silently — the operator's spec would be accepted while missing the thing they
 * sent. The engine avoids the same hazard by building each side in a `Map`
 * (parseAbSideConfig, discovery-ab.main.ts); here it is a refusal, since
 * `__proto__` is not one of the nine and could not be honoured anyway.
 */
const SideConfigSchema = z.preprocess((raw, context) => {
  if (typeof raw === "object" && raw !== null && Object.getOwnPropertyNames(raw).includes("__proto__")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "__proto__ is not readable by the discovery graph; this harness cannot test it",
    });
  }
  return raw;
}, z.record(z.string()));

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
    overrides: z
      .object({ models: z.record(z.string().min(1)), env: z.record(z.string()) })
      .strict()
      .optional(),
    flags: RunFlagsSchema,
    // Values are operator-chosen flag values, never credentials: the keys are
    // confined to DISCOVERY_AB_ENV_KEYS below, and the whole object is recorded
    // on the run record so the artifact and the site agree on what was compared.
    sides: z
      .object({ a: SideConfigSchema, b: SideConfigSchema })
      .strict()
      .optional(),
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
    // Ad-hoc overrides ARE the profile: combining them with a named profile
    // would make the run's provenance ambiguous, so the pair is inexpressible.
    if (spec.overrides !== undefined && spec.profile !== "default") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overrides"],
        message: 'ad-hoc overrides require profile "default"; launch a named config and tweak it from the Configs page instead',
      });
    }
    // Per-side configuration is required by exactly the harness that compares two
    // of them, and inexpressible for every other. Both directions are refusals:
    // a discovery-ab run without `sides` has nothing to compare, and `sides` on a
    // scorecard harness would be a control the engine never reads.
    const requiresSides = REQUIRES_SIDES[spec.harness as EvalRunSpec["harness"]];
    if (requiresSides && spec.sides === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sides"],
        message: `The ${spec.harness} harness compares two environment configurations; a run without "sides" has nothing to compare`,
      });
    }
    if (!requiresSides && spec.sides !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sides"],
        message: `The ${spec.harness} harness scores one configuration against a committed baseline and does not accept "sides"`,
      });
    }
    if (spec.sides !== undefined) {
      for (const issue of abSideIssues(spec.sides)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["sides", ...issue.path], message: issue.message });
      }
    }
  }) as unknown as z.ZodType<EvalRunSpec>;

export interface RenderedRun {
  argv: string[];
  env: Record<string, string>;
  /** False when any selection flag narrows the corpus. */
  fullCorpus: boolean;
  /** What this one run costs: cases x runs x sides. Recorded on the run record. */
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
 *
 * The returned env is a function of the profile alone, never of the ops server's
 * own environment: the executor spawns with { ...process.env, ...env }, so any
 * value not written here is inherited verbatim and `bun --env-file` in the
 * harness script cannot undo it.
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

  // Per-side configuration, sorted by key so two launches of one configuration
  // render identical argv regardless of the order the form built it in — the
  // engine sorts the same way when it re-serializes for its children
  // (abConfigDeltas in services/api/src/cli/discovery-ab.main.ts).
  //
  // Checked again here rather than trusted from RunSpecSchema, exactly as the
  // flag list above is: the engine ignores unrecognised argv, so anything wrong
  // that reaches this point is spent, not reported.
  if (REQUIRES_SIDES[spec.harness]) {
    if (spec.sides === undefined) {
      throw new Error(`The ${spec.harness} harness compares two environment configurations; a run without "sides" has nothing to compare`);
    }
    const refusal = abSideIssues(spec.sides)[0];
    if (refusal !== undefined) throw new Error(refusal.message);
    for (const id of SIDE_IDS) {
      for (const key of Object.keys(spec.sides[id]).sort()) {
        argv.push(`--${id}`, `${key}=${spec.sides[id][key]!}`);
      }
    }
  } else if (spec.sides !== undefined) {
    throw new Error(`The ${spec.harness} harness scores one configuration against a committed baseline and does not accept "sides"`);
  }

  argv.push("--report", reportPath);
  if (resolved.experimental) argv.push("--no-save");

  const env = { ...resolved.env };

  // Always write EVAL_MODEL_OVERRIDES, empty when the profile declares no models.
  // An operator may legitimately have it in .env.test (it is documented in
  // .env.example) and `eval:web` loads that file into the ops server, so an
  // unwritten key would be inherited by the child: a default-profile run would
  // silently use overridden models while being recorded and displayed as
  // experimental: false with env {} — false provenance on a run the harness
  // auto-saves into eval/<harness>/runs/. readModelOverrides trims and treats
  // an empty value as "no overrides", so "" fully neutralises an inherited one.
  if (!("EVAL_MODEL_OVERRIDES" in env)) {
    env.EVAL_MODEL_OVERRIDES = "";
  }

  // Pin OPENROUTER_FALLBACK_MODEL=none when the profile overrides models, unless
  // the profile explicitly set it. Reason: for an experimental run that exists
  // precisely to measure a specific model, a silent fallback means the artifact
  // could record results produced by a DIFFERENT model than the one under test —
  // which would corrupt the comparison the whole feature exists to support.
  //
  // Deliberately NOT neutralised with "" for the default profile the way
  // EVAL_MODEL_OVERRIDES is: getFallbackModelName treats unset as "use the
  // default cross-vendor fallback" but "" as "fallbacks disabled", so writing ""
  // would change default-profile behaviour rather than preserve it. An inherited
  // value therefore still applies here, matching a plain CLI run.
  if (Object.keys(resolved.profile.models).length > 0 && !("OPENROUTER_FALLBACK_MODEL" in env)) {
    env.OPENROUTER_FALLBACK_MODEL = "none";
  }

  const fullCorpus = !SELECTION_FLAGS.some((name) => spec.flags[name] !== undefined);
  const runs = spec.flags.runs ?? descriptor.defaultRuns;
  const cases = fullCorpus ? descriptor.caseCount : 1;

  return { argv, env, fullCorpus, workload: cases * runs * SIDES_PER_RUN[spec.harness] };
}
