import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ALLOWED_CONFIG_MODELS, DEFAULT_PROFILE_NAME, loadProfiles, resolveAdHoc, resolveProfile, validateConfigOverrides } from "../ops.profiles.js";
import { HARNESS_REGISTRY } from "../ops.registry.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ops-profiles-"));
  await writeFile(
    path.join(dir, "default.json"),
    JSON.stringify({ name: "default", description: "d", models: {}, env: {} }),
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadProfiles", () => {
  it("loads a valid profile", async () => {
    await writeFile(
      path.join(dir, "claude-evaluator.json"),
      JSON.stringify({
        name: "claude-evaluator",
        description: "Claude as evaluator",
        models: { opportunityEvaluator: "anthropic/claude-sonnet-4" },
        env: {},
      }),
    );

    const profiles = await loadProfiles(dir);

    expect(profiles.map((p) => p.name).sort()).toEqual(["claude-evaluator", "default"]);
  });

  it("rejects an environment key outside the allowlist", async () => {
    await writeFile(
      path.join(dir, "sneaky.json"),
      JSON.stringify({ name: "sneaky", description: "x", models: {}, env: { DATABASE_URL: "postgres://evil" } }),
    );

    await expect(loadProfiles(dir)).rejects.toThrow(/DATABASE_URL/);
  });

  it("rejects a file whose name does not match its profile name", async () => {
    await writeFile(
      path.join(dir, "mismatch.json"),
      JSON.stringify({ name: "other", description: "x", models: {}, env: {} }),
    );

    await expect(loadProfiles(dir)).rejects.toThrow(/mismatch/);
  });

  it("rejects a default profile that carries overrides", async () => {
    await writeFile(
      path.join(dir, "default.json"),
      JSON.stringify({ name: "default", description: "d", models: { hydeGenerator: "x" }, env: {} }),
    );

    await expect(loadProfiles(dir)).rejects.toThrow(/default/i);
  });
});

describe("resolveProfile", () => {
  it("marks the default profile non-experimental with no env", () => {
    const resolved = resolveProfile({ name: DEFAULT_PROFILE_NAME, description: "d", models: {}, env: {} });

    expect(resolved.experimental).toBe(false);
    expect(resolved.env).toEqual({});
  });

  it("marks any other profile experimental and emits EVAL_MODEL_OVERRIDES", () => {
    const resolved = resolveProfile({
      name: "claude-evaluator",
      description: "x",
      models: { opportunityEvaluator: "anthropic/claude-sonnet-4" },
      env: { DISCOVERY_CONTEXT_TO_INTENT: "0" },
    });

    expect(resolved.experimental).toBe(true);
    expect(resolved.env.DISCOVERY_CONTEXT_TO_INTENT).toBe("0");
    expect(JSON.parse(resolved.env.EVAL_MODEL_OVERRIDES)).toEqual({
      opportunityEvaluator: "anthropic/claude-sonnet-4",
    });
  });

  it("fingerprints identical profiles identically and differing ones differently", () => {
    const a = resolveProfile({ name: "p", description: "x", models: { hydeGenerator: "m" }, env: { A: "1" } as never });
    const b = resolveProfile({ name: "p", description: "y", models: { hydeGenerator: "m" }, env: { A: "1" } as never });
    const c = resolveProfile({ name: "p", description: "x", models: { hydeGenerator: "n" }, env: { A: "1" } as never });

    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });
});

describe("validateConfigOverrides", () => {
  it("accepts a valid override set", () => {
    expect(validateConfigOverrides({
      models: { opportunityEvaluator: ALLOWED_CONFIG_MODELS[0] },
      env: { RUN_OPPORTUNITY_EVAL_IN_PARALLEL: "true" },
    })).toEqual([]);
  });

  it("rejects a model outside the curated allowlist and names it", () => {
    const issues = validateConfigOverrides({
      models: { opportunityEvaluator: "anthropic/claude-opus-4.8" },
      env: {},
    });
    expect(issues.some((i) => i.includes("claude-opus-4.8"))).toBe(true);
  });

  it("rejects an agent key no scorecard harness exercises", () => {
    const issues = validateConfigOverrides({ models: { negotiator: ALLOWED_CONFIG_MODELS[0] }, env: {} });
    expect(issues.some((i) => i.includes("negotiator"))).toBe(true);
  });

  it("rejects an env key outside PROFILE_ENV_ALLOWLIST", () => {
    const issues = validateConfigOverrides({ models: {}, env: { OPENROUTER_API_KEY: "x" } });
    expect(issues.some((i) => i.includes("OPENROUTER_API_KEY"))).toBe(true);
  });

  it("accepts valid env values of every kind", () => {
    expect(validateConfigOverrides({
      models: {},
      env: {
        POOL_QUESTIONS_MODE: "on",
        NEGOTIATION_EVIDENCE_QUESTIONS_MODE: "shadow",
        RUN_OPPORTUNITY_EVAL_IN_PARALLEL: "false",
        NEGOTIATION_MAX_TURNS_CHAT: "12",
        DISCOVERY_REJECTION_COOLDOWN_DAYS: "3.5",
        DISCOVERY_CONTEXT_TO_INTENT: "0",
        DISCOVERY_ALLOWED_TYPES: "intent,profile",
      },
    })).toEqual([]);
  });

  it("rejects an enum value outside the flag's valid values, naming key, value and choices", () => {
    const issues = validateConfigOverrides({ models: {}, env: { POOL_QUESTIONS_MODE: "banana" } });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("POOL_QUESTIONS_MODE");
    expect(issues[0]).toContain("banana");
    expect(issues[0]).toContain("off");
    expect(issues[0]).toContain("on");
  });

  it("rejects a non-boolean value for a boolean flag", () => {
    const issues = validateConfigOverrides({ models: {}, env: { RUN_OPPORTUNITY_EVAL_IN_PARALLEL: "yes" } });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("RUN_OPPORTUNITY_EVAL_IN_PARALLEL");
    expect(issues[0]).toContain("yes");
    expect(issues[0]).toContain("true");
    expect(issues[0]).toContain("false");
  });

  it("rejects a non-integer value for an integer flag", () => {
    const issues = validateConfigOverrides({ models: {}, env: { NEGOTIATION_MAX_TURNS_CHAT: "lots" } });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("NEGOTIATION_MAX_TURNS_CHAT");
    expect(issues[0]).toContain("lots");
    expect(issues[0]).toMatch(/integer/i);
  });

  it("rejects non-positive and non-numeric values for a positive-number flag", () => {
    for (const value of ["-3", "0", "soon"]) {
      const issues = validateConfigOverrides({ models: {}, env: { DISCOVERY_REJECTION_COOLDOWN_DAYS: value } });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain("DISCOVERY_REJECTION_COOLDOWN_DAYS");
      expect(issues[0]).toContain(value);
      expect(issues[0]).toMatch(/positive number/i);
    }
  });
});

describe("resolveAdHoc", () => {
  it("fingerprints identically to a named profile with the same payload", () => {
    const overrides = { models: { opportunityEvaluator: "anthropic/claude-sonnet-4" }, env: {} };
    const adHoc = resolveAdHoc(overrides);
    const named = resolveProfile({ name: "candidate", description: "x", ...overrides });
    expect(adHoc.fingerprint).toBe(named.fingerprint);
    expect(adHoc.experimental).toBe(true);
    expect(adHoc.profile.name).toBe("default");
    expect(adHoc.env.EVAL_MODEL_OVERRIDES).toBe(JSON.stringify(overrides.models));
  });
});

describe("HARNESS_REGISTRY agents", () => {
  it("maps each harness to the agents it exercises", () => {
    expect(HARNESS_REGISTRY.matching.agents).toEqual(["opportunityEvaluator"]);
    expect(HARNESS_REGISTRY.opportunity.agents).toEqual(["opportunityPresenter"]);
    expect(HARNESS_REGISTRY.profile.agents).toEqual(["profileGenerator"]);
    expect(HARNESS_REGISTRY.premise.agents).toEqual(["premiseDecomposer", "premiseAnalyzer"]);
  });
});
