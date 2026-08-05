import { z } from "zod";

import { DISCOVERY_ENV_KEYS } from "./ops.allowlist.js";
import { flagValueIssues } from "./ops.flags.js";
import { HARNESS_REGISTRY, OPS_HARNESSES } from "./ops.registry.js";
import { SIDE_IDS, SUPPORTS_SIDES, abSideIssues, sidesPerRun, singleConfigIssues } from "./ops.sides.js";
import type { ResolvedProfile } from "./ops.profiles.js";
import type { EvalRunSpec, RunFlags } from "./ops.types.js";

/**
 * The per-side rules live in ops.sides.ts and the per-harness flag bounds in
 * ops.flags.ts, both dependency-free so the launch form can import the very
 * same definitions (this module's zod schemas cannot be tree-shaken out of a
 * browser bundle). Re-exported here because this is where the server reads them
 * from.
 */
export { REQUIRES_SIDES, SIDES_PER_RUN, SUPPORTS_SIDES, abSideIssues, sidesPerRun, singleConfigIssues, type AbSideIssue } from "./ops.sides.js";
export { flagValueIssues, type FlagValueIssue } from "./ops.flags.js";

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
 * (parseAbSideConfig, discovery.main.ts); here it is a refusal, since
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
    // confined to DISCOVERY_ENV_KEYS below, and the whole object is recorded
    // on the run record so the artifact and the site agree on what was compared.
    sides: z
      .object({ a: SideConfigSchema, b: SideConfigSchema })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((spec, context) => {
    // Names AND values, against this harness's own registry entry. RunFlagsSchema
    // above bounds each flag by the widest value any harness allows, which is not
    // what any single harness accepts: discovery caps --runs at 10 where these
    // bounds allow 25. Checking only the names is how a spec the engine refuses
    // got queued, displayed and spent against.
    //
    // The entry's `accepts` is what is enforced, never the control bounds beside
    // it: --alpha is offered by a step-0.001 control as 0.001..0.999 and accepted
    // as any 0 < alpha < 1, which is the engines' own check. Enforcing the
    // control's resolution refused runs every engine would have run.
    const harness = spec.harness as EvalRunSpec["harness"];
    for (const issue of flagValueIssues(harness, HARNESS_REGISTRY[harness].flags, spec.flags)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["flags", issue.name], message: issue.message });
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
    // Per-side configuration is offered by exactly the harness that can compare
    // two of them, and inexpressible for every other: `sides` on a scorecard
    // harness would be a control the engine never reads.
    //
    // Its ABSENCE is no longer a refusal for discovery. A run without `sides`
    // measures one configuration (spec §5), which the engine expresses as
    // `--env KEY=VALUE`; that configuration arrives as `overrides.env`, checked
    // below.
    const supportsSides = SUPPORTS_SIDES[spec.harness as EvalRunSpec["harness"]];
    if (!supportsSides && spec.sides !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sides"],
        message: `The ${spec.harness} harness scores one configuration against a committed baseline and does not accept "sides"`,
      });
    }
    // A single discovery run still has to say what it is measuring, and its keys
    // face the same per-key rules a pair's do (membership, non-blank, length,
    // line terminators, and the value's real meaning at its read site). Without
    // this, the cheaper shape would be the unchecked one.
    //
    // Only the AD-HOC shape is checkable here. A named profile's env lives in a
    // file or the config store, neither of which a synchronous zod refinement can
    // read, so `spec.overrides` is undefined by construction for that shape (the
    // pair is inexpressible, just above) and an unconditional check would see `{}`
    // and refuse EVERY named config on this harness with "this run has no
    // configuration" — false in the operator's terms, since their config is full
    // of flags. The named path is checked in `launchRun` once the profile has been
    // resolved, and by `renderRun` before anything is spent; `singleConfigIssues`
    // is the one definition all three call.
    if (supportsSides && spec.sides === undefined && spec.overrides !== undefined) {
      for (const issue of singleConfigIssues(spec.overrides.env)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: issue.path.length === 0 ? ["overrides", "env"] : ["overrides", "env", ...issue.path],
          message: issue.message,
        });
      }
    }
    // A pair of sides is the whole configuration of the run that carries it.
    //
    // The launch form states on the page that both sides run the same models and
    // the same environment and differ only in the flags below, and this is what
    // makes that statement true of the API and not merely of the form. A named
    // config or an ad-hoc override alongside `sides` would change the models
    // under BOTH sides at once — moving both pass rates without changing the
    // difference the run measures — and its `env` block would set a shared
    // baseline for the OTHER allowlisted keys, unrecorded in the artifact's
    // configDiff, which names only the per-side keys. (A profile env value for a
    // key that IS being A/B-ed is harmless: withDiscoveryEnvironment applies the
    // side's keys last. It is the keys nobody is comparing that would silently
    // move.) So the pair is inexpressible rather than explained after the fact.
    if (spec.sides !== undefined && spec.profile !== "default") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile"],
        message:
          `The ${spec.harness} harness compares two environment configurations under one shared baseline, so it `
          + `runs under profile "default"; a named config would change the models and the unpaired env keys under `
          + `both sides at once, unrecorded in the artifact`,
      });
    }
    if (spec.sides !== undefined && spec.overrides !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overrides"],
        message:
          `The ${spec.harness} harness compares two environment configurations, which are its whole configuration; `
          + `ad-hoc overrides would apply to both sides at once, moving both results without changing the `
          + `difference the run measures`,
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

  // Names and bounds, re-checked here rather than trusted from RunSpecSchema for
  // the same reason the flag list always was: the engine ignores argv it does
  // not recognise and enforces its own caps only after loading its eval modules,
  // so anything wrong that reaches this point is spent, not reported.
  const refusedFlag = flagValueIssues(spec.harness, descriptor.flags, spec.flags)[0];
  if (refusedFlag !== undefined) throw new Error(refusedFlag.message);

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
  // (abConfigDeltas in services/api/src/cli/discovery.main.ts).
  //
  // Checked again here rather than trusted from RunSpecSchema, exactly as the
  // flag list above is: the engine ignores unrecognised argv, so anything wrong
  // that reaches this point is spent, not reported.
  if (spec.sides !== undefined) {
    if (!SUPPORTS_SIDES[spec.harness]) {
      throw new Error(`The ${spec.harness} harness scores one configuration against a committed baseline and does not accept "sides"`);
    }
    // The sides are the whole configuration: nothing else may differ between
    // them or sit under both of them unrecorded. RunSpecSchema refuses the pair
    // too; this is the layer that would otherwise SPEND on it.
    if (spec.profile !== "default" || spec.overrides !== undefined) {
      throw new Error(
        `The ${spec.harness} harness compares two environment configurations under one shared baseline; `
        + `a named config or ad-hoc override would change both sides at once, unrecorded in the artifact`,
      );
    }
    const refusal = abSideIssues(spec.sides)[0];
    if (refusal !== undefined) throw new Error(refusal.message);
    for (const id of SIDE_IDS) {
      for (const key of Object.keys(spec.sides[id]).sort()) {
        argv.push(`--${id}`, `${key}=${spec.sides[id][key]!}`);
      }
    }
  } else if (SUPPORTS_SIDES[spec.harness]) {
    // The single shape. The configuration is the resolved env — whether it came
    // from an ad-hoc override or a named config — narrowed to the keys the
    // discovery graph reads, because `--env` is how the engine is told what to
    // set and it refuses a key it cannot read (assertAbEnvConfig).
    //
    // Narrowing rather than passing everything is what makes a named config
    // launchable here at all: a config carrying a key this harness does not read
    // is legitimate (spec §6) and its unread keys are reported, not rendered
    // into argv the engine would refuse. The full env still reaches the child
    // through `env` below, so nothing is hidden from the process — only from the
    // flag list the engine parses.
    const configured = Object.keys(resolved.env)
      .filter((key) => DISCOVERY_ENV_KEYS.includes(key))
      .sort();
    const config = Object.fromEntries(configured.map((key) => [key, resolved.env[key]!]));
    const refusal = singleConfigIssues(config)[0];
    if (refusal !== undefined) throw new Error(refusal.message);
    for (const key of configured) argv.push("--env", `${key}=${config[key]!}`);
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

  return { argv, env, fullCorpus, workload: cases * runs * sidesPerRun(spec) };
}
