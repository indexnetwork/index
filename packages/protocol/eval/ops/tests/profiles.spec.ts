import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ENV_SECRET_KEYS, PROFILE_ENV_ALLOWLIST } from "../ops.allowlist.js";
import { HARNESS_ENV_KEYS } from "../ops.envcatalog.js";
import { ALLOWED_CONFIG_MODELS, DEFAULT_PROFILE_NAME, harnessesReading, loadProfiles, resolveAdHoc, resolveProfile, unreadEnvKeys, validateConfigOverrides } from "../ops.profiles.js";
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

  it("accepts a key a harness reads that PROFILE_ENV_ALLOWLIST does not name", async () => {
    // C7: repo profiles were checked against PROFILE_ENV_ALLOWLIST while saved
    // configs were checked against the derived catalogues, so a code-reviewed,
    // committed profile could set STRICTLY LESS than a config saved from a
    // browser. NEGOTIATOR_STANCE is read by the discovery graph and is absent
    // from that list, which is what made the asymmetry visible.
    expect(PROFILE_ENV_ALLOWLIST).not.toContain("NEGOTIATOR_STANCE");
    expect(HARNESS_ENV_KEYS.discovery).toContain("NEGOTIATOR_STANCE");

    await writeFile(
      path.join(dir, "stance.json"),
      JSON.stringify({ name: "stance", description: "x", models: {}, env: { NEGOTIATOR_STANCE: "concise" } }),
    );

    const profiles = await loadProfiles(dir);
    expect(profiles.map((p) => p.name).sort()).toEqual(["default", "stance"]);
  });

  it("still rejects a credential, which no profile may set", async () => {
    // Widening the boundary must not widen it to credentials. DISCOVERY_TARGETS
    // is the case the shape rule cannot see — it carries connection strings but
    // is named after what it points at — so this proves the list-based half of
    // `isCredentialEnvKey` is reached from the profile loader too.
    await writeFile(
      path.join(dir, "targets.json"),
      JSON.stringify({ name: "targets", description: "x", models: {}, env: { DISCOVERY_TARGETS: "{}" } }),
    );

    await expect(loadProfiles(dir)).rejects.toThrow(/DISCOVERY_TARGETS.*credential/);
  });

  it("rejects a key no harness reads and no protocol flag names", async () => {
    await writeFile(
      path.join(dir, "invented.json"),
      JSON.stringify({ name: "invented", description: "x", models: {}, env: { NOT_A_REAL_FLAG: "1" } }),
    );

    await expect(loadProfiles(dir)).rejects.toThrow(/not offered by any harness/);
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

  it("rejects an env key no harness reads and no allowlist names", () => {
    const issues = validateConfigOverrides({ models: {}, env: { TOTALLY_UNKNOWN_KEY: "x" } });
    expect(issues.some((i) => i.includes("TOTALLY_UNKNOWN_KEY"))).toBe(true);
  });

  it("refuses every credential by name, as a guard independent of the catalogue", () => {
    // The spec's second guard. The generator already excludes these from every
    // harness catalogue; this refuses them at the request boundary so that a
    // bug in the generator cannot be enough to make a credential settable.
    // Asserted on the reason, not just the key: "not read by any harness" would
    // be the wrong answer for a credential every harness reads.
    for (const secret of ENV_SECRET_KEYS) {
      const issues = validateConfigOverrides({ models: {}, env: { [secret]: "x" } });
      expect(issues.some((i) => i.includes(secret) && i.includes("credential")), `${secret} not refused as a credential`).toBe(true);
    }
  });

  it("refuses a credential-shaped key even if one reached a catalogue", () => {
    // ENV_SECRET_KEYS is an exact-match list of two. A review showed the real
    // generator will happily catalogue OPENROUTER_API_KEY_2, ANTHROPIC_API_KEY,
    // DATABASE_URL and NEON_API_KEY if a harness closure ever reads them — and
    // the last two are read one import away from the discovery runner. None of
    // these is on the list, so an exact-match guard would pass them straight to
    // the child process. The shape rule refuses them without anyone having to
    // predict the name.
    for (const key of ["OPENROUTER_API_KEY_2", "ANTHROPIC_API_KEY", "DATABASE_URL", "NEON_API_KEY", "REDIS_URL"]) {
      const issues = validateConfigOverrides({ models: {}, env: { [key]: "x" } });
      expect(issues.some((i) => i.includes(key) && i.includes("credential")), `${key} not refused as a credential`).toBe(true);
    }
  });

  it("accepts the keys the derived catalogue added, which the old allowlist refused", () => {
    // These are read by real harnesses (eval/ops/ops.envcatalog.ts) but absent
    // from the hand-written PROFILE_ENV_ALLOWLIST. Before the catalogue existed
    // the boundary refused them, so the launch form could not offer them at all.
    expect(validateConfigOverrides({
      models: {},
      env: {
        NEGOTIATOR_STANCE: "skeptic",
        NEGOTIATION_SCREEN_MODE: "enforce",
        HYDE_FRAME_CONSTRAINTS_ENABLED: "true",
        OPENROUTER_MAX_RETRIES: "0",
        CHAT_REASONING_EFFORT: "high",
      },
    })).toEqual([]);
  });

  it("rejects a value the live service would silently fall back on", () => {
    // The whole point of documenting these keys: an unrecognised value is not
    // refused at runtime, it falls back, so a run would measure the default
    // while reporting the configuration the operator typed.
    const issues = validateConfigOverrides({ models: {}, env: { NEGOTIATOR_STANCE: "agressive" } });
    expect(issues.some((i) => i.includes("NEGOTIATOR_STANCE"))).toBe(true);
  });

  it("rejects an EVAL_MODEL_OVERRIDES value its read site would throw on", () => {
    // readModelOverrides throws lazily, at first model construction — after a
    // discovery run has reset its branches and started spending.
    expect(validateConfigOverrides({ models: {}, env: { EVAL_MODEL_OVERRIDES: "{oops" } }).length).toBeGreaterThan(0);
    expect(validateConfigOverrides({
      models: {},
      env: { EVAL_MODEL_OVERRIDES: '{"noSuchAgent":"google/gemini-2.5-flash"}' },
    }).length).toBeGreaterThan(0);
    expect(validateConfigOverrides({
      models: {},
      env: { EVAL_MODEL_OVERRIDES: '{"opportunityEvaluator":"google/gemini-2.5-flash"}' },
    })).toEqual([]);
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

  it("rejects negative integers for integer flags, matching startup.env optionalInt", () => {
    for (const value of ["-3", "+4", "4.5"]) {
      const issues = validateConfigOverrides({ models: {}, env: { NEGOTIATION_MAX_TURNS_CHAT: value } });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain("NEGOTIATION_MAX_TURNS_CHAT");
      expect(issues[0]).toContain(value);
      expect(issues[0]).toMatch(/integer/i);
    }
  });

  it("rejects a value the use site would silently fall back on, for a flag startup.env.ts calls free text", () => {
    // DISCOVERY_PROFILE_SOURCE is z.string() upstream but a two-valued enum where
    // it is read (discovery.env.ts): an unknown value warns once and runs
    // `premise`. Accepting it here would save a config that does not do what it says.
    const issues = validateConfigOverrides({ models: {}, env: { DISCOVERY_PROFILE_SOURCE: "user-context" } });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("DISCOVERY_PROFILE_SOURCE");
    expect(issues[0]).toContain("user-context");
    expect(issues[0]).toContain("user_context");
    expect(validateConfigOverrides({ models: {}, env: { DISCOVERY_PROFILE_SOURCE: "user_context" } })).toEqual([]);
  });

  it("rejects an unknown token in a comma-separated flag, which the reader would ignore", () => {
    // discoveryAllowedTypes ignores unknown tokens, and falls back to BOTH when
    // nothing valid remains — so "intnet" is not a narrower corpus, it is the
    // default corpus under a name that says otherwise.
    const issues = validateConfigOverrides({ models: {}, env: { DISCOVERY_ALLOWED_TYPES: "intnet" } });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("DISCOVERY_ALLOWED_TYPES");
    expect(issues[0]).toContain("intnet");
    for (const value of ["intent", "profile", "intent,profile", "intent, profile"]) {
      expect(validateConfigOverrides({ models: {}, env: { DISCOVERY_ALLOWED_TYPES: value } })).toEqual([]);
    }
  });

  it("rejects a turn cap of 0, which the reader turns back into the default", () => {
    const issues = validateConfigOverrides({ models: {}, env: { NEGOTIATION_MAX_TURNS_CHAT: "0" } });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("NEGOTIATION_MAX_TURNS_CHAT");
    expect(issues[0]).toMatch(/at least 1/);
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

describe("validateConfigOverrides per harness", () => {
  it("accepts a key the harness's own code reads", () => {
    // CHAT_MODEL is in matching's catalogue, so it is settable there. Before
    // this task the four scorecard harnesses had no env editor at all, on the
    // false premise that they read nothing.
    expect(validateConfigOverrides({ models: {}, env: { CHAT_MODEL: "google/gemini-2.5-flash" } }, "matching")).toEqual([]);
  });

  it("refuses a key another harness reads but this one does not, naming both", () => {
    // The union check alone passed this: DISCOVERY_ALLOWED_TYPES is read by
    // SOME harness, just never by matching. Recording it would have written a
    // value onto the run record that nothing acts on.
    const issues = validateConfigOverrides({ models: {}, env: { DISCOVERY_ALLOWED_TYPES: "intent" } }, "matching");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("DISCOVERY_ALLOWED_TYPES");
    expect(issues[0]).toContain("matching");
    // Names where it IS read, so the message is actionable rather than a dead end.
    expect(issues[0]).toContain("discovery");
  });

  it("still refuses a credential, by name, for every harness", () => {
    for (const harness of ["matching", "discovery"] as const) {
      const issues = validateConfigOverrides({ models: {}, env: { OPENROUTER_API_KEY: "sk-x" } }, harness);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain("OPENROUTER_API_KEY");
      expect(issues[0]).toMatch(/credential/i);
    }
  });

  it("keeps the union when no harness is named, because a saved config names none", () => {
    // The Configs page saves a config without choosing a harness to run it
    // under, so it has nothing to check against. Narrowing here would make a
    // legitimate shared config unsavable.
    expect(validateConfigOverrides({ models: {}, env: { DISCOVERY_ALLOWED_TYPES: "intent" } })).toEqual([]);
  });

  it("reports every harness that reads a key", () => {
    // Model and provider knobs are read by all five; a discovery flag by one.
    expect(harnessesReading("CHAT_MODEL")).toEqual(["matching", "profile", "premise", "opportunity", "discovery"]);
    expect(harnessesReading("DISCOVERY_ALLOWED_TYPES")).toEqual(["discovery"]);
    expect(harnessesReading("NOT_A_REAL_KEY")).toEqual([]);
  });
});

describe("unreadEnvKeys", () => {
  it("names the keys a harness will not read", () => {
    expect(unreadEnvKeys("matching", { CHAT_MODEL: "m", DISCOVERY_ALLOWED_TYPES: "intent" }))
      .toEqual(["DISCOVERY_ALLOWED_TYPES"]);
  });

  it("is empty when the harness reads everything the config sets", () => {
    expect(unreadEnvKeys("discovery", { DISCOVERY_ALLOWED_TYPES: "intent", CHAT_MODEL: "m" })).toEqual([]);
  });

  it("reports rather than filters, so the record matches the process", () => {
    // The value is still injected into the child environment; this function only
    // says what will be ignored. A filter here would make the run record
    // disagree with the process that actually ran.
    const env = { CHAT_MODEL: "m", DISCOVERY_ALLOWED_TYPES: "intent" };
    unreadEnvKeys("matching", env);
    expect(env).toEqual({ CHAT_MODEL: "m", DISCOVERY_ALLOWED_TYPES: "intent" });
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
