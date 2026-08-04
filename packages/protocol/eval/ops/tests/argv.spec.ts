import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DISCOVERY_AB_ENV_KEYS } from "../ops.allowlist.js";
import { renderRun, RunSpecSchema } from "../ops.argv.js";
import { ENV_FLAG_METADATA } from "../ops.metadata.js";
import { resolveProfile } from "../ops.profiles.js";
import { HARNESS_REGISTRY } from "../ops.registry.js";

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
  "services", "api", "src", "cli", "discovery-ab.flags.ts",
);

function abSpec(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: "eval", harness: "discovery-ab", profile: "default", flags: {}, sides: SIDES, ...extra };
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
    // A discovery-ab run is one process that runs the corpus on side a and on
    // side b. Recording cases x runs would report half of what it spent, on the
    // one harness here that costs real branch resets and live graph calls.
    const rendered = renderRun(
      { kind: "eval", harness: "discovery-ab", profile: "default", flags: { runs: 4 }, sides: SIDES },
      DEFAULT,
      REPORT,
    );
    expect(rendered.workload).toBe(HARNESS_REGISTRY["discovery-ab"].caseCount * 4 * 2);

    // Narrowing the corpus narrows the count but not the doubling: both sides
    // still run the case that survived the filter.
    const oneCase = renderRun(
      { kind: "eval", harness: "discovery-ab", profile: "default", flags: { runs: 4, case: "historical/songwriting-duo" }, sides: SIDES },
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
    // Read, never retyped: discovery-ab.flags.ts imports node:fs, so ops.argv.ts
    // cannot import AB_FLAGS without breaking the Vite bundle the app builds from
    // these modules. Pinning the list as source text is the same technique
    // registry.spec.ts uses for AB_MAX_REPETITIONS: a key added, removed or
    // renamed in the engine fails here instead of being silently dropped by a
    // parser that ignores what it does not recognise.
    const source = readFileSync(AB_FLAGS_SOURCE, "utf8");
    const literal = source.match(/export const AB_FLAGS[^=]*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
    if (!literal) throw new Error("AB_FLAGS not found in discovery-ab.flags.ts");
    const engineKeys = [...literal[1]!.matchAll(/'([A-Z0-9_]+)'/g)].map((match) => match[1]!);

    // Guards the pin against passing vacuously on an empty or unparsed match.
    expect(engineKeys.length).toBe(9);
    expect([...DISCOVERY_AB_ENV_KEYS].sort()).toEqual([...engineKeys].sort());
  });

  it("can describe every key it offers", () => {
    // The launch form labels each key from ENV_FLAG_METADATA, so a key the site
    // may offer but cannot describe would render as a bare identifier.
    const described = new Set(ENV_FLAG_METADATA.map((meta) => meta.key));
    for (const key of DISCOVERY_AB_ENV_KEYS) expect(described.has(key), `${key} has no metadata`).toBe(true);
  });

  it("refuses a discovery-ab run that names no configurations", () => {
    expect(refusal({ kind: "eval", harness: "discovery-ab", profile: "default", flags: {} })).toMatch(/sides/i);
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
    // Mirrors assertSymmetricKeySets in discovery-ab.plan.ts: an omitted flag
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
    expect(refusal(abSpec({ sides: { a: {}, b: { DISCOVERY_PROFILE_SOURCE: "premise" } } }))).toMatch(/side a/i);
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
});

describe("renderRun sides", () => {
  it("renders --a/--b pairs in a stable order alongside the shared selection", () => {
    const rendered = renderRun(
      {
        kind: "eval",
        harness: "discovery-ab",
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
      "bun", "run", "eval:discovery-ab", "--",
      "--runs", "2",
      "--case", "historical/songwriting-duo",
      "--a", "DISCOVERY_PROFILE_SOURCE=premise",
      "--a", "DISCOVERY_SOURCE_PREMISE_LIMIT=10",
      "--b", "DISCOVERY_PROFILE_SOURCE=user_context",
      "--b", "DISCOVERY_SOURCE_PREMISE_LIMIT=10",
      "--report", REPORT,
    ]);
  });

  it("refuses to render a discovery-ab run without sides", () => {
    // The engine ignores what it does not recognise and would refuse a sideless
    // run only after loading its eval modules, so renderRun is the last place
    // that can refuse before a run is queued.
    expect(() =>
      renderRun({ kind: "eval", harness: "discovery-ab", profile: "default", flags: {} }, DEFAULT, REPORT),
    ).toThrow(/sides/i);
  });

  it("refuses to render sides for a harness that takes one configuration", () => {
    expect(() =>
      renderRun({ kind: "eval", harness: "matching", profile: "default", flags: {}, sides: SIDES }, DEFAULT, REPORT),
    ).toThrow(/matching/);
  });

  it("refuses to render a pair the engine would refuse", () => {
    expect(() =>
      renderRun(
        {
          kind: "eval",
          harness: "discovery-ab",
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
