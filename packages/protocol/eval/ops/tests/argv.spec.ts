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
    const rendered = renderRun({ kind: "eval", harness: "matching", profile: "default", flags: {} }, DEFAULT, REPORT);
    expect(rendered.env.OPENROUTER_FALLBACK_MODEL).toBeUndefined();
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
