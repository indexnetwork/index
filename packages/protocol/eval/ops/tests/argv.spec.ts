import { describe, expect, it } from "bun:test";

import { renderRun, RunSpecSchema } from "../ops.argv.js";
import { resolveProfile } from "../ops.profiles.js";

const DEFAULT = resolveProfile({ name: "default", description: "d", models: {}, env: {} });
const EXPERIMENT = resolveProfile({
  name: "claude-evaluator",
  description: "x",
  models: { opportunityEvaluator: "anthropic/claude-sonnet-4" },
  env: {},
});

const REPORT = "/tmp/.ops-runs/run-1/report.json";

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

  it("computes workload as cases x runs", () => {
    const rendered = renderRun({ kind: "eval", harness: "matching", profile: "default", flags: { runs: 7 } }, DEFAULT, REPORT);
    expect(rendered.workload).toBeGreaterThan(0);
    expect(rendered.workload % 7).toBe(0);
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
