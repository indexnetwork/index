import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DISCOVERY_ENV_KEYS } from "../ops.allowlist.js";
import { renderRun, RunSpecSchema } from "../ops.argv.js";
import { flagValueIssues } from "../ops.flags.js";
import { ENV_FLAG_METADATA } from "../ops.metadata.js";
import { resolveProfile } from "../ops.profiles.js";
import { HARNESS_REGISTRY, OPS_HARNESSES } from "../ops.registry.js";

const DEFAULT = resolveProfile({ name: "default", description: "d", models: {}, env: {} });
const EXPERIMENT = resolveProfile({
  name: "claude-evaluator",
  description: "x",
  models: { opportunityEvaluator: "anthropic/claude-sonnet-4" },
  env: {},
});

const REPORT = "/tmp/.ops-runs/run-1/report.json";

/** A minimal valid pair: same key set, one differing value. */
const SIDES = {
  a: { DISCOVERY_PROFILE_SOURCE: "premise" },
  b: { DISCOVERY_PROFILE_SOURCE: "user_context" },
};

const AB_FLAGS_SOURCE = path.join(
  import.meta.dir, "..", "..", "..", "..", "..",
  "services", "api", "src", "cli", "discovery.flags.ts",
);

const AB_MAIN_SOURCE = path.join(
  import.meta.dir, "..", "..", "..", "..", "..",
  "services", "api", "src", "cli", "discovery.main.ts",
);

/**
 * The engine's own KEY=VALUE pattern, read from its source rather than retyped.
 * `parseAbSideConfig` throws "--a expects KEY=VALUE" on anything it does not
 * match, and that throw happens after the site has queued and displayed the run.
 */
function engineAssignmentPattern(): RegExp {
  const source = readFileSync(AB_MAIN_SOURCE, "utf8");
  const literal = source.match(/const AB_ENV_ASSIGNMENT = \/(.+)\/;/);
  if (!literal) throw new Error("AB_ENV_ASSIGNMENT not found in discovery.main.ts");
  return new RegExp(literal[1]!);
}

function abSpec(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: "eval", harness: "discovery", profile: "default", flags: {}, sides: SIDES, ...extra };
}

/** Every refusal message of a failed parse, joined; the messages are the point here. */
function refusal(spec: Record<string, unknown>): string {
  const result = RunSpecSchema.safeParse(spec);
  if (result.success) throw new Error(`Expected a refusal, got a valid spec: ${JSON.stringify(spec)}`);
  return result.error.issues.map((issue) => issue.message).join(" | ");
}

describe("RunSpecSchema", () => {
  it("rejects an unknown harness", () => {
    expect(RunSpecSchema.safeParse({ kind: "eval", harness: "hyde", profile: "default", flags: {} }).success).toBe(false);
  });

  it("rejects an unknown flag", () => {
    const result = RunSpecSchema.safeParse({
      kind: "eval",
      harness: "matching",
      profile: "default",
      flags: { updateBaseline: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects --tier on a harness that does not support it", () => {
    expect(RunSpecSchema.safeParse({ kind: "eval", harness: "premise", profile: "default", flags: { tier: 4 } }).success).toBe(false);
  });

  it("rejects a selection value that would read as a flag", () => {
    // The value becomes its own argv element, so "--update-baseline" would reach the
    // harness's parser looking exactly like the destructive flag this API never renders.
    for (const flags of [{ case: "--update-baseline" }, { rule: "-f" }, { case: "-" }]) {
      const result = RunSpecSchema.safeParse({ kind: "eval", harness: "matching", profile: "default", flags });
      expect(result.success).toBe(false);
    }
  });

  it("accepts an ordinary selection value", () => {
    const result = RunSpecSchema.safeParse({
      kind: "eval",
      harness: "matching",
      profile: "default",
      flags: { case: "location/known-city" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-positive run count", () => {
    expect(RunSpecSchema.safeParse({ kind: "eval", harness: "matching", profile: "default", flags: { runs: 0 } }).success).toBe(false);
  });
});

describe("RunSpecSchema flag bounds", () => {
  it("refuses a run count this harness caps below the shared schema's, naming the bound", () => {
    // The failure this closes: RunFlagsSchema allows 1..25 because the scorecard
    // harnesses do, discovery's registry entry caps --runs at 10
    // (AB_MAX_REPETITIONS), and the schema used to check only flag NAMES. So
    // `--runs 25` parsed, was queued, was priced at 250 model invocations on the
    // launch page and then died on the engine's own "--runs must not exceed 10"
    // — a refusal after the operator had committed to the spend.
    const message = refusal(abSpec({ flags: { runs: 25 } }));
    expect(message).toContain("--runs");
    expect(message).toContain(String(HARNESS_REGISTRY["discovery"].flags.find((f) => f.name === "runs")!.max));
    // The harness's own maximum is still accepted.
    expect(RunSpecSchema.safeParse(abSpec({ flags: { runs: 10 } })).success).toBe(true);
  });

  it("enforces a scorecard harness's own bounds the same way", () => {
    // --tier is 1..4 in matching's own parser (parseTier throws on anything
    // else), so this is that harness's rule being enforced rather than
    // discovery's being special-cased.
    const message = refusal({ kind: "eval", harness: "matching", profile: "default", flags: { tier: 9 } });
    expect(message).toContain("--tier");
    expect(message).toContain("between 1 and 4");
    expect(RunSpecSchema.safeParse({ kind: "eval", harness: "matching", profile: "default", flags: { tier: 4 } }).success).toBe(true);
  });

  it("never refuses a value the harness accepts, however the control is shaped", () => {
    // The regression: `--alpha` is offered by a step-0.001 control, so the
    // registry expressed it as 0.001..0.999 — "the inclusive equivalent at step
    // resolution", in that entry's own words. Making the control's resolution
    // the API's authority refused `--alpha 0.0005` with the sentence "and the
    // harness itself would refuse it", which is false: every engine's check is
    // `alpha <= 0 || alpha >= 1`, so it would have run it. A control's step is
    // not a rule, and a refusal must not invent one.
    for (const harness of ["matching", "profile", "premise", "opportunity"] as const) {
      for (const alpha of [0.0005, 0.0001, 0.9995]) {
        const spec = { kind: "eval", harness, profile: "default", flags: { alpha } };
        expect(RunSpecSchema.safeParse(spec).success, `${harness} --alpha ${alpha}`).toBe(true);
      }
      // The ends themselves stay refused, because the engine refuses them.
      for (const alpha of [0, 1]) {
        const spec = { kind: "eval", harness, profile: "default", flags: { alpha } };
        expect(RunSpecSchema.safeParse(spec).success, `${harness} --alpha ${alpha}`).toBe(false);
      }
      expect(refusal({ kind: "eval", harness, profile: "default", flags: { alpha: 0 } }))
        .toContain(`The ${harness} harness accepts --alpha above 0 and below 1`);
    }
  });

  it("says who refuses a value, and claims nothing else", () => {
    // Two bounds on one flag, held by two different parties. The scorecard
    // engines refuse `--runs 0` themselves (`--runs must be a positive
    // integer`) and cap nothing above; 26 is this site's own ceiling
    // (RunFlagsSchema), and the harness would have run it. So only one of these
    // two refusals may speak for the harness.
    const floor = refusal({ kind: "eval", harness: "matching", profile: "default", flags: { runs: 0 } });
    expect(floor).toContain("The matching harness accepts --runs no lower than 1");
    expect(floor).toContain("the harness itself would refuse it");

    const ceiling = refusal({ kind: "eval", harness: "matching", profile: "default", flags: { runs: 26 } });
    expect(ceiling).toContain("This site accepts --runs no higher than 25");
    expect(ceiling).not.toContain("harness itself");

    // Nothing this function can produce claims the harness would refuse a value
    // unless the registry says the harness holds that bound.
    for (const harness of OPS_HARNESSES) {
      for (const flag of HARNESS_REGISTRY[harness].flags) {
        if (flag.kind !== "number") continue;
        const step = flag.step ?? 1;
        const { min, max } = flag.accepts ?? {};
        const cases: [number, "harness" | "site"][] = [
          ...(min === undefined ? [] : [[min.exclusive === true ? min.value : min.value - step, min.heldBy] as [number, "harness" | "site"]]),
          ...(max === undefined ? [] : [[max.exclusive === true ? max.value : max.value + step, max.heldBy] as [number, "harness" | "site"]]),
        ];
        for (const [value, heldBy] of cases) {
          const issue = flagValueIssues(harness, HARNESS_REGISTRY[harness].flags, { [flag.name]: value })[0];
          expect(issue, `${harness} ${flag.cli} ${value}`).toBeDefined();
          expect(issue!.message.includes("the harness itself would refuse it"), `${harness} ${flag.cli} ${value}`)
            .toBe(heldBy === "harness");
        }
      }
    }
  });

  it("accepts no value outside any harness's declared bounds", () => {
    // Registry-driven, so a harness added later is covered without being listed
    // here, and a bound tightened later cannot be enforced by the form alone.
    let checked = 0;
    for (const harness of OPS_HARNESSES) {
      const base = harness === "discovery"
        ? abSpec()
        : { kind: "eval", harness, profile: "default", flags: {} };
      for (const flag of HARNESS_REGISTRY[harness].flags) {
        if (flag.kind !== "number") continue;
        const step = flag.step ?? 1;
        const outside = [
          ...(flag.min === undefined ? [] : [flag.min - step]),
          ...(flag.max === undefined ? [] : [flag.max + step]),
        ];
        for (const value of outside) {
          const spec = { ...base, flags: { [flag.name]: value } };
          expect(RunSpecSchema.safeParse(spec).success, `${harness} accepted ${flag.cli} ${value}`).toBe(false);
          checked += 1;
        }
        // And the bounds themselves are inside, or the form's min/max attributes
        // would offer values the schema refuses.
        for (const value of [flag.min, flag.max]) {
          if (value === undefined) continue;
          const spec = { ...base, flags: { [flag.name]: value } };
          expect(RunSpecSchema.safeParse(spec).success, `${harness} refused ${flag.cli} ${value}`).toBe(true);
        }
      }
    }
    // Guards the guard: fourteen bounded numeric flags across the five
    // harnesses, probed just outside each bound.
    expect(checked).toBe(28);
  });

  it("reports an unsupported flag through the same function the form calls", () => {
    // One definition of "would this harness accept these flags", so the page and
    // the schema cannot come to disagree about it.
    const issues = flagValueIssues("discovery", HARNESS_REGISTRY["discovery"].flags, { tier: 2 });
    expect(issues.map((issue) => issue.name)).toEqual(["tier"]);
    expect(refusal({ kind: "eval", harness: "discovery", profile: "default", flags: { tier: 2 }, sides: SIDES }))
      .toContain(issues[0]!.message);
  });
});

describe("renderRun", () => {
  it("renders the package script with a report path and no destructive flag", () => {
    const rendered = renderRun(
      { kind: "eval", harness: "matching", profile: "default", flags: { runs: 3 } },
      DEFAULT,
      REPORT,
    );

    expect(rendered.argv).toEqual(["bun", "run", "eval:matching", "--", "--runs", "3", "--report", REPORT]);
    expect(rendered.argv).not.toContain("--update-baseline");
    expect(rendered.argv).not.toContain("--force");
    expect(rendered.fullCorpus).toBe(true);
  });

  it("renders boolean flags without a value and selection flags with one", () => {
    const rendered = renderRun(
      { kind: "eval", harness: "matching", profile: "default", flags: { noJudge: true, case: "location/known" } },
      DEFAULT,
      REPORT,
    );

    expect(rendered.argv).toContain("--no-judge");
    expect(rendered.argv.join(" ")).toContain("--case location/known");
    expect(rendered.fullCorpus).toBe(false);
  });

  it("forces --no-save and injects overrides for an experimental profile", () => {
    const rendered = renderRun(
      { kind: "eval", harness: "matching", profile: "claude-evaluator", flags: {} },
      EXPERIMENT,
      REPORT,
    );

    expect(rendered.argv).toContain("--no-save");
    expect(JSON.parse(rendered.env.EVAL_MODEL_OVERRIDES)).toEqual({
      opportunityEvaluator: "anthropic/claude-sonnet-4",
    });
  });

  it("never adds --no-save for the default profile", () => {
    const rendered = renderRun({ kind: "eval", harness: "matching", profile: "default", flags: {} }, DEFAULT, REPORT);
    expect(rendered.argv).not.toContain("--no-save");
  });

  it("computes workload as cases x runs for a harness that passes over the corpus once", () => {
    const rendered = renderRun({ kind: "eval", harness: "matching", profile: "default", flags: { runs: 7 } }, DEFAULT, REPORT);
    expect(rendered.workload).toBeGreaterThan(0);
    expect(rendered.workload % 7).toBe(0);
    expect(rendered.workload).toBe(HARNESS_REGISTRY.matching.caseCount * 7);
  });

  it("counts both sides for the harness whose single run evaluates every case twice", () => {
    // A discovery run is one process that runs the corpus on side a and on
    // side b. Recording cases x runs would report half of what it spent, on the
    // one harness here that costs real branch resets and live graph calls.
    const rendered = renderRun(
      { kind: "eval", harness: "discovery", profile: "default", flags: { runs: 4 }, sides: SIDES },
      DEFAULT,
      REPORT,
    );
    expect(rendered.workload).toBe(HARNESS_REGISTRY["discovery"].caseCount * 4 * 2);

    // Narrowing the corpus narrows the count but not the doubling: both sides
    // still run the case that survived the filter.
    const oneCase = renderRun(
      { kind: "eval", harness: "discovery", profile: "default", flags: { runs: 4, case: "historical/songwriting-duo" }, sides: SIDES },
      DEFAULT,
      REPORT,
    );
    expect(oneCase.fullCorpus).toBe(false);
    expect(oneCase.workload).toBe(1 * 4 * 2);
  });

  it("refuses a spec whose profile name does not match the resolved profile", () => {
    expect(() =>
      renderRun({ kind: "eval", harness: "matching", profile: "other", flags: {} }, DEFAULT, REPORT),
    ).toThrow(/profile/i);
  });

  it("pins OPENROUTER_FALLBACK_MODEL=none when the profile has model overrides", () => {
    const rendered = renderRun(
      { kind: "eval", harness: "matching", profile: "claude-evaluator", flags: {} },
      EXPERIMENT,
      REPORT,
    );

    expect(rendered.env.OPENROUTER_FALLBACK_MODEL).toBe("none");
  });

  it("does not pin OPENROUTER_FALLBACK_MODEL for the default profile", () => {
    // Deliberately absent rather than "": for this variable unset means "use the
    // default cross-vendor fallback" while "" means "fallbacks disabled", so
    // writing "" here would silently disable a resilience feature. See the
    // neutralisation test below for why EVAL_MODEL_OVERRIDES is handled differently.
    const rendered = renderRun({ kind: "eval", harness: "matching", profile: "default", flags: {} }, DEFAULT, REPORT);
    expect(rendered.env.OPENROUTER_FALLBACK_MODEL).toBeUndefined();
  });

  it("neutralises an inherited EVAL_MODEL_OVERRIDES for a default-profile run", () => {
    // The executor spawns with { ...process.env, ...record.env }. An operator who
    // put EVAL_MODEL_OVERRIDES in .env.test (documented in .env.example) puts it in
    // the ops server's own environment, and `bun --env-file` does NOT override an
    // inherited variable — so without an explicit empty value the child would run
    // overridden models while the record claims env {} and experimental false.
    const rendered = renderRun({ kind: "eval", harness: "matching", profile: "default", flags: {} }, DEFAULT, REPORT);

    expect(rendered.env.EVAL_MODEL_OVERRIDES).toBe("");
  });

  it("still sets EVAL_MODEL_OVERRIDES for an experimental profile", () => {
    const rendered = renderRun(
      { kind: "eval", harness: "matching", profile: "claude-evaluator", flags: {} },
      EXPERIMENT,
      REPORT,
    );

    expect(JSON.parse(rendered.env.EVAL_MODEL_OVERRIDES)).toEqual({
      opportunityEvaluator: "anthropic/claude-sonnet-4",
    });
  });

  it("renders the same env for a default-profile run regardless of ambient state", () => {
    // Determinism is the actual property being protected: the rendered env must be
    // a function of the profile alone, never of what happens to be in process.env.
    const first = renderRun({ kind: "eval", harness: "matching", profile: "default", flags: {} }, DEFAULT, REPORT);
    const previous = process.env.EVAL_MODEL_OVERRIDES;
    process.env.EVAL_MODEL_OVERRIDES = JSON.stringify({ opportunityEvaluator: "anthropic/claude-sonnet-4" });
    try {
      const second = renderRun({ kind: "eval", harness: "matching", profile: "default", flags: {} }, DEFAULT, REPORT);
      expect(second.env).toEqual(first.env);
    } finally {
      if (previous === undefined) delete process.env.EVAL_MODEL_OVERRIDES;
      else process.env.EVAL_MODEL_OVERRIDES = previous;
    }
  });

  it("does not override OPENROUTER_FALLBACK_MODEL if already present in resolved env", () => {
    // Note: OPENROUTER_FALLBACK_MODEL is not in PROFILE_ENV_ALLOWLIST, so profiles
    // loaded from files cannot set it. However, the pin logic checks for its presence
    // in the resolved env (not profile.env) to allow other code paths to set it.
    const customProfile = resolveProfile({
      name: "custom",
      description: "custom",
      models: { opportunityEvaluator: "anthropic/claude-sonnet-4" },
      env: {},
    });
    // Simulate some other code path having already set it in the resolved env
    customProfile.env.OPENROUTER_FALLBACK_MODEL = "openai/gpt-4o";
    
    const rendered = renderRun(
      { kind: "eval", harness: "matching", profile: "custom", flags: {} },
      customProfile,
      REPORT,
    );

    // Pre-existing value should be preserved (not overwritten with "none")
    expect(rendered.env.OPENROUTER_FALLBACK_MODEL).toBe("openai/gpt-4o");
  });
});

describe("RunSpecSchema sides", () => {
  it("keeps the site's nine offerable keys identical to the engine's AB_FLAGS", () => {
    // Read, never retyped: discovery.flags.ts imports node:fs, so ops.argv.ts
    // cannot import AB_FLAGS without breaking the Vite bundle the app builds from
    // these modules. Pinning the list as source text is the same technique
    // registry.spec.ts uses for AB_MAX_REPETITIONS: a key added, removed or
    // renamed in the engine fails here instead of being silently dropped by a
    // parser that ignores what it does not recognise.
    const source = readFileSync(AB_FLAGS_SOURCE, "utf8");
    const literal = source.match(/export const AB_FLAGS[^=]*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
    if (!literal) throw new Error("AB_FLAGS not found in discovery.flags.ts");
    const engineKeys = [...literal[1]!.matchAll(/'([A-Z0-9_]+)'/g)].map((match) => match[1]!);

    // Guards the pin against passing vacuously on an empty or unparsed match.
    expect(engineKeys.length).toBe(9);
    expect([...DISCOVERY_ENV_KEYS].sort()).toEqual([...engineKeys].sort());
  });

  it("can describe every key it offers", () => {
    // The launch form labels each key from ENV_FLAG_METADATA, so a key the site
    // may offer but cannot describe would render as a bare identifier.
    const described = new Set(ENV_FLAG_METADATA.map((meta) => meta.key));
    for (const key of DISCOVERY_ENV_KEYS) expect(described.has(key), `${key} has no metadata`).toBe(true);
  });

  it("refuses a discovery run that names no configurations", () => {
    expect(refusal({ kind: "eval", harness: "discovery", profile: "default", flags: {} })).toMatch(/sides/i);
  });

  it("refuses sides on a harness that scores against a baseline", () => {
    expect(refusal({ kind: "eval", harness: "matching", profile: "default", flags: {}, sides: SIDES })).toMatch(/matching/);
  });

  it("refuses a key the discovery graph does not read, naming it", () => {
    const message = refusal(abSpec({
      sides: { a: { POOL_QUESTIONS_MODE: "on" }, b: { POOL_QUESTIONS_MODE: "off" } },
    }));
    expect(message).toContain("POOL_QUESTIONS_MODE");
  });

  it("refuses an asymmetric key set, naming the key and both sides", () => {
    // Mirrors assertSymmetricKeySets in discovery.plan.ts: an omitted flag
    // takes the graph's own default, which may equal the other side's value —
    // so the run would measure nothing while attributing noise to that flag.
    const message = refusal(abSpec({
      sides: {
        a: { DISCOVERY_PROFILE_SOURCE: "premise", DISCOVERY_SOURCE_PREMISE_LIMIT: "10" },
        b: { DISCOVERY_PROFILE_SOURCE: "user_context" },
      },
    }));
    expect(message).toContain("DISCOVERY_SOURCE_PREMISE_LIMIT");
    expect(message).toMatch(/side a/);
    expect(message).toMatch(/side b/);
  });

  it("refuses two identical configurations", () => {
    const message = refusal(abSpec({
      sides: { a: { DISCOVERY_PROFILE_SOURCE: "premise" }, b: { DISCOVERY_PROFILE_SOURCE: "premise" } },
    }));
    expect(message).toMatch(/identical/i);
  });

  it("refuses a side with no configuration at all", () => {
    // Asserts the rule's own message, not merely that side a is mentioned: the
    // asymmetry refusal names side a too, so a laxer assertion passed with this
    // rule deleted.
    expect(refusal(abSpec({ sides: { a: {}, b: { DISCOVERY_PROFILE_SOURCE: "premise" } } })))
      .toMatch(/Side a has no configuration/);
  });

  it("refuses an empty or whitespace value", () => {
    for (const value of ["", "   "]) {
      const message = refusal(abSpec({
        sides: { a: { DISCOVERY_PROFILE_SOURCE: value }, b: { DISCOVERY_PROFILE_SOURCE: "premise" } },
      }));
      expect(message).toContain("DISCOVERY_PROFILE_SOURCE");
    }
  });

  it("accepts a symmetric pair that differs in one value", () => {
    expect(RunSpecSchema.safeParse(abSpec({ flags: { runs: 2, case: "historical/songwriting-duo" } })).success).toBe(true);
  });

  it("refuses a value the discovery graph would silently replace with its default", () => {
    // The expensive failure this rule exists for: `user-context` (hyphen) is not
    // a value discoveryProfileSource knows, so it warns once and runs `premise`
    // — the same thing side a runs. Both sides would execute the identical
    // configuration and the artifact would report `configDiff: premise vs
    // user-context`, a difference that never existed, after two Neon branch
    // resets and a full corpus of live provider calls.
    const message = refusal(abSpec({
      sides: { a: { DISCOVERY_PROFILE_SOURCE: "premise" }, b: { DISCOVERY_PROFILE_SOURCE: "user-context" } },
    }));
    expect(message).toContain("DISCOVERY_PROFILE_SOURCE");
    expect(message).toContain("user-context");
    expect(message).toMatch(/side b/);
    expect(message).toContain("user_context");

    // The underscore spelling — the one the graph actually reads — is accepted.
    expect(RunSpecSchema.safeParse(abSpec({
      sides: { a: { DISCOVERY_PROFILE_SOURCE: "premise" }, b: { DISCOVERY_PROFILE_SOURCE: "user_context" } },
    })).success).toBe(true);
  });

  it("applies the same value rules the saved-config path uses, to every kind", () => {
    // One definition (envFlagValueIssue), three callers. A value refused for a
    // saved config must not be accepted for a side of a run that costs more.
    const refused: [string, string][] = [
      ["DISCOVERY_ALLOWED_TYPES", "intnet"],          // ignored token -> the default corpus
      ["DISCOVERY_SOURCE_PREMISE_LIMIT", "-5"],       // negative -> falls back to 40
      ["DISCOVERY_SOURCE_PREMISE_LIMIT", "banana"],
      ["NEGOTIATION_MAX_TURNS_CHAT", "0"],            // `Number(x) || 4` -> the default
      ["RUN_OPPORTUNITY_EVAL_IN_PARALLEL", "yes"],    // read as `=== 'true'` -> false
      ["DISCOVERY_REJECTION_COOLDOWN_DAYS", "0"],     // not positive -> falls back to 7 days
      ["DISCOVERY_CONTEXT_TO_INTENT", "2"],
    ];
    for (const [key, value] of refused) {
      const message = refusal(abSpec({ sides: { a: { [key]: value }, b: { [key]: "1" } } }));
      expect(message, `${key}=${value} was accepted`).toContain(key);
      expect(message, `${key}=${value} refusal does not quote the value`).toContain(value);
    }

    const accepted: [string, string, string][] = [
      ["DISCOVERY_ALLOWED_TYPES", "intent", "intent,profile"],
      ["DISCOVERY_SOURCE_PREMISE_LIMIT", "0", "40"],
      ["NEGOTIATION_MAX_TURNS_CHAT", "1", "4"],
      ["RUN_OPPORTUNITY_EVAL_IN_PARALLEL", "true", "false"],
      ["DISCOVERY_REJECTION_COOLDOWN_DAYS", "0.5", "7"],
      ["DISCOVERY_CONTEXT_TO_INTENT", "0", "1"],
    ];
    for (const [key, a, b] of accepted) {
      const result = RunSpecSchema.safeParse(abSpec({ sides: { a: { [key]: a }, b: { [key]: b } } }));
      expect(result.success, `${key}: ${a} vs ${b} was refused`).toBe(true);
    }
  });

  it("refuses a value carrying a line break, which the engine's parser would reject", () => {
    const message = refusal(abSpec({
      sides: { a: { DISCOVERY_ALLOWED_TYPES: "intent\nprofile" }, b: { DISCOVERY_ALLOWED_TYPES: "profile" } },
    }));
    expect(message).toContain("DISCOVERY_ALLOWED_TYPES");
    expect(message).toMatch(/side a/);
    expect(message).toMatch(/line break/);
    // Not a hypothetical: the engine's pattern really does refuse it.
    expect(engineAssignmentPattern().test("DISCOVERY_ALLOWED_TYPES=intent\nprofile")).toBe(false);
  });

  it("refuses an oversized value rather than storing it and failing at spawn", () => {
    const message = refusal(abSpec({
      sides: {
        a: { DISCOVERY_ALLOWED_TYPES: "intent".padEnd(5_000, "x") },
        b: { DISCOVERY_ALLOWED_TYPES: "profile" },
      },
    }));
    expect(message).toContain("DISCOVERY_ALLOWED_TYPES");
    expect(message).toMatch(/side a/);
    expect(message).toMatch(/5000 characters/);
  });

  it("refuses a named config alongside sides, because the page says both sides run one baseline", () => {
    // The launch page states that both sides run the same models and the same
    // environment and differ only in the flags below. A named config makes that
    // false: its models move both pass rates without changing the difference the
    // run measures, and its env block sets a shared baseline for the keys nobody
    // is comparing — unrecorded, because the artifact's configDiff names only
    // the per-side keys. (A profile value for a key that IS paired is harmless:
    // withDiscoveryEnvironment applies the side's keys last.)
    const message = refusal(abSpec({ profile: "claude-evaluator" }));
    expect(message).toMatch(/default/);
    expect(message).toMatch(/both sides/);
  });

  it("refuses ad-hoc overrides alongside sides", () => {
    const message = refusal(abSpec({ overrides: { models: { opportunityEvaluator: "anthropic/claude-sonnet-4" }, env: {} } }));
    expect(message).toMatch(/both sides/);
    // Still accepted for a harness that scores one configuration.
    expect(RunSpecSchema.safeParse({
      kind: "eval",
      harness: "matching",
      profile: "default",
      flags: {},
      overrides: { models: { opportunityEvaluator: "anthropic/claude-sonnet-4" }, env: {} },
    }).success).toBe(true);
  });

  it("refuses __proto__ instead of letting the record silently drop it", () => {
    // zod's record copies entries with assignment, so a `__proto__` key vanishes
    // rather than being refused: the spec would be accepted while missing what
    // the operator sent. The engine dodges the same hazard with a Map
    // (parseAbSideConfig). Built through JSON.parse because that is how it
    // arrives — an object literal would set the prototype instead.
    const sides = JSON.parse('{"a":{"__proto__":"x","DISCOVERY_PROFILE_SOURCE":"premise"},"b":{"DISCOVERY_PROFILE_SOURCE":"user_context"}}');
    expect(refusal(abSpec({ sides }))).toContain("__proto__");
  });
});

describe("renderRun sides", () => {
  it("renders --a/--b pairs in a stable order alongside the shared selection", () => {
    const rendered = renderRun(
      {
        kind: "eval",
        harness: "discovery",
        profile: "default",
        flags: { runs: 2, case: "historical/songwriting-duo" },
        sides: {
          // Deliberately unsorted, and the same keys on both sides: the engine
          // sorts (abConfigDeltas), so two launches of one configuration must
          // produce byte-identical argv regardless of the order the form built it in.
          a: { DISCOVERY_SOURCE_PREMISE_LIMIT: "10", DISCOVERY_PROFILE_SOURCE: "premise" },
          b: { DISCOVERY_PROFILE_SOURCE: "user_context", DISCOVERY_SOURCE_PREMISE_LIMIT: "10" },
        },
      },
      DEFAULT,
      REPORT,
    );

    expect(rendered.argv).toEqual([
      "bun", "run", "eval:discovery", "--",
      "--runs", "2",
      "--case", "historical/songwriting-duo",
      "--a", "DISCOVERY_PROFILE_SOURCE=premise",
      "--a", "DISCOVERY_SOURCE_PREMISE_LIMIT=10",
      "--b", "DISCOVERY_PROFILE_SOURCE=user_context",
      "--b", "DISCOVERY_SOURCE_PREMISE_LIMIT=10",
      "--report", REPORT,
    ]);
  });

  it("refuses to render a discovery run without sides", () => {
    // The engine ignores what it does not recognise and would refuse a sideless
    // run only after loading its eval modules, so renderRun is the last place
    // that can refuse before a run is queued.
    expect(() =>
      renderRun({ kind: "eval", harness: "discovery", profile: "default", flags: {} }, DEFAULT, REPORT),
    ).toThrow(/sides/i);
  });

  it("refuses to render sides for a harness that takes one configuration", () => {
    expect(() =>
      renderRun({ kind: "eval", harness: "matching", profile: "default", flags: {}, sides: SIDES }, DEFAULT, REPORT),
    ).toThrow(/matching/);
  });

  it("emits only assignments the engine's own parser accepts", () => {
    // The round trip the site depends on and cannot see: every `--a`/`--b` value
    // must match AB_ENV_ASSIGNMENT, read from discovery.main.ts. Without this,
    // either side could change its half of the contract and nothing would fail
    // until an operator paid for a run the parser refused.
    const pattern = engineAssignmentPattern();
    expect(pattern.test("DISCOVERY_PROFILE_SOURCE=premise")).toBe(true);
    expect(pattern.test("not an assignment")).toBe(false);

    const sides = {
      a: { DISCOVERY_ALLOWED_TYPES: "intent,profile", DISCOVERY_SOURCE_PREMISE_LIMIT: "0", DISCOVERY_PROFILE_SOURCE: "premise" },
      b: { DISCOVERY_ALLOWED_TYPES: "intent", DISCOVERY_SOURCE_PREMISE_LIMIT: "40", DISCOVERY_PROFILE_SOURCE: "user_context" },
    };
    const rendered = renderRun(
      { kind: "eval", harness: "discovery", profile: "default", flags: { runs: 2 }, sides },
      DEFAULT,
      REPORT,
    );

    let checked = 0;
    for (const [index, token] of rendered.argv.entries()) {
      if (token !== "--a" && token !== "--b") continue;
      const assignment = rendered.argv[index + 1]!;
      const match = pattern.exec(assignment);
      expect(match, `${assignment} is not a KEY=VALUE the engine accepts`).not.toBeNull();
      const side = token === "--a" ? sides.a : sides.b;
      // What the engine would parse is what the operator asked for.
      expect(side[match![1] as keyof typeof side]).toBe(match![2]);
      checked += 1;
    }
    // Guards the guard: six assignments, or the loop pinned nothing.
    expect(checked).toBe(6);
  });

  it("refuses to render a run count above this harness's own cap", () => {
    // RunSpecSchema refuses it too; this is the layer that would otherwise SPEND
    // on it, and the engine's own check runs only after the child has loaded its
    // eval modules and reset two branches.
    expect(() =>
      renderRun(
        { kind: "eval", harness: "discovery", profile: "default", flags: { runs: 25 }, sides: SIDES },
        DEFAULT,
        REPORT,
      ),
    ).toThrow(/--runs/);
  });

  it("refuses to render sides under anything but the shared default baseline", () => {
    expect(() =>
      renderRun(
        { kind: "eval", harness: "discovery", profile: "claude-evaluator", flags: {}, sides: SIDES },
        EXPERIMENT,
        REPORT,
      ),
    ).toThrow(/both sides at once/);
    expect(() =>
      renderRun(
        {
          kind: "eval",
          harness: "discovery",
          profile: "default",
          flags: {},
          overrides: { models: { opportunityEvaluator: "anthropic/claude-sonnet-4" }, env: {} },
          sides: SIDES,
        },
        DEFAULT,
        REPORT,
      ),
    ).toThrow(/both sides at once/);
  });

  /**
   * What DISCOVERY_FLAGS' comment in ops.registry.ts rests on. `--no-save` is
   * the one argv that list does not cover, and the engine would silently drop it
   * (parseAbRunArgs keeps only the flags it knows) — so the claim that the site
   * never sends it has to be checked rather than assumed. renderRun appends it
   * for `resolved.experimental` alone, and the two producers of that flag (a
   * non-default profile, ad-hoc overrides) are both refused alongside `sides` by
   * the test above, while `sides` is mandatory here.
   */
  it("never renders --no-save for discovery, because no run of it can be experimental", () => {
    const rendered = renderRun(
      { kind: "eval", harness: "discovery", profile: "default", flags: { runs: 2 }, sides: SIDES },
      DEFAULT,
      REPORT,
    );

    expect(rendered.argv).not.toContain("--no-save");
    // Vacuity guard: the same renderer does append it, so the absence above is a
    // property of this harness's runs and not of this call.
    expect(
      renderRun({ kind: "eval", harness: "matching", profile: "claude-evaluator", flags: {} }, EXPERIMENT, REPORT).argv,
    ).toContain("--no-save");
    // And a sides run under that same experimental profile never renders at all.
    expect(() =>
      renderRun(
        { kind: "eval", harness: "discovery", profile: "claude-evaluator", flags: {}, sides: SIDES },
        EXPERIMENT,
        REPORT,
      ),
    ).toThrow();
  });

  it("refuses to render a pair the engine would refuse", () => {
    expect(() =>
      renderRun(
        {
          kind: "eval",
          harness: "discovery",
          profile: "default",
          flags: {},
          sides: { a: { DISCOVERY_PROFILE_SOURCE: "premise" }, b: { DISCOVERY_PROFILE_SOURCE: "premise" } },
        },
        DEFAULT,
        REPORT,
      ),
    ).toThrow(/identical/i);
  });
});

/**
 * The modules ops.argv.ts re-exports so the SPA can import the server's own
 * rules without importing the server.
 *
 * Their headers say they must stay dependency-free, and nothing but this
 * enforced it: adding `import { z } from "zod"` to ops.sides.ts would keep every
 * gate green while silently restoring the +67 kB (17 kB gzip) the split was made
 * to avoid — zod plus RunSpecSchema's module-level schema construction, which no
 * bundler can drop. Same guard ops.metadata.ts already carries in metadata.spec.ts.
 *
 * EVERY form of import counts, not only the named one. A bare `import "zod";`
 * has no `from` clause, and a guard that looked for one let it through — while
 * the bundler does not: a side-effect import pulls the whole package in exactly
 * as the named one does. `import(...)` and `require(...)` are here for the same
 * reason: what matters is the specifier, not the syntax that reaches it.
 */
describe("browser-importable module boundary", () => {
  // ops.envcatalog.ts is generated, and its text comes from a template in
  // ops.envcatalog.build.ts — a module that imports node:fs and Bun.Transpiler.
  // Nothing stops a future template edit from emitting a runtime import into the
  // generated file, which would ship into the SPA with every gate green, so the
  // generated output is held to the same boundary as the hand-written modules.
  //
  // The list is every eval/ops module the SPA imports for its *value* (checked
  // against apps/eval-ops/src): ops.sides, ops.flags, ops.metadata, ops.progress
  // and ops.allowlist, plus the generated ops.envcatalog they reach through.
  // ops.metadata carries an equivalent guard of its own in metadata.spec.ts;
  // ops.progress and ops.allowlist had none, and happened to import nothing —
  // a property no test held them to, which is the same gap in a different file.
  const DEPENDENCY_FREE = [
    "ops.sides.ts",
    "ops.flags.ts",
    "ops.envcatalog.ts",
    "ops.progress.ts",
    "ops.allowlist.ts",
  ] as const;

  for (const module of DEPENDENCY_FREE) {
    it(`${module} stays dependency-free so the browser bundle can import it`, () => {
      const source = readFileSync(path.join(import.meta.dir, "..", module), "utf8");
      const importSpecifiers = [...source.matchAll(/\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)].map(
        (m) => m[1],
      );
      // No lower bound on the count: ops.progress.ts and ops.allowlist.ts import
      // nothing at all, and "imports nothing" is the strongest possible form of
      // the property this test defends.
      for (const specifier of importSpecifiers) {
        expect(specifier).not.toMatch(/^node:/);
        expect(specifier).not.toMatch(/^(fs|crypto|path|os|util|stream)$/);
        // Every import is a relative one of another dependency-free ops module:
        // a bare specifier is a package, and a package is the thing this file
        // exists not to pull into the SPA.
        expect(specifier, `${module} imports ${specifier}`).toMatch(
          /^\.\/ops\.(allowlist|envcatalog|flags|metadata|registry|sides|types)\.js$/,
        );
      }
    });
  }
});
