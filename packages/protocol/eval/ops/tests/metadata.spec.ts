import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PROFILE_ENV_ALLOWLIST } from "../ops.allowlist.js";
import { ALLOWED_CONFIG_MODELS } from "../ops.profiles.js";
import { HARNESS_REGISTRY, OPS_HARNESSES } from "../ops.registry.js";
import { ENV_FLAG_METADATA, HARNESS_AGENT_METADATA, MODEL_METADATA, type EnvFlagMeta } from "../ops.metadata.js";

describe("ENV_FLAG_METADATA", () => {
  it("covers exactly the allowlisted keys, once each, in allowlist order", () => {
    expect(ENV_FLAG_METADATA.map((m) => m.key)).toEqual([...PROFILE_ENV_ALLOWLIST]);
  });

  it("gives every flag a label, description, and defaultDescription", () => {
    for (const meta of ENV_FLAG_METADATA) {
      expect(meta.label.trim().length).toBeGreaterThan(0);
      expect(meta.description.trim().length).toBeGreaterThan(0);
      expect(meta.defaultDescription.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every enum and boolean flag explicit non-empty values", () => {
    for (const meta of ENV_FLAG_METADATA) {
      if (meta.kind === "enum" || meta.kind === "boolean") {
        expect(meta.values, `${meta.key} must declare values`).toBeDefined();
        expect(meta.values!.length).toBeGreaterThan(1);
      } else {
        expect(meta.values, `${meta.key} must not declare values`).toBeUndefined();
      }
    }
  });

  it("mirrors the startup.env.ts / use-site schemas exactly", () => {
    const byKey = new Map(ENV_FLAG_METADATA.map((m) => [m.key, m]));
    const expected: Record<string, Pick<EnvFlagMeta, "kind" | "values">> = {
      DISCOVERY_ALLOWED_TYPES: { kind: "string" },
      DISCOVERY_PROFILE_SOURCE: { kind: "string" },
      DISCOVERY_CONTEXT_TO_INTENT: { kind: "enum", values: ["0", "1"] },
      DISCOVERY_REJECTION_COOLDOWN_DAYS: { kind: "number" },
      DISCOVERY_SOURCE_PREMISE_LIMIT: { kind: "integer" },
      RUN_OPPORTUNITY_EVAL_IN_PARALLEL: { kind: "boolean", values: ["true", "false"] },
      INTRODUCER_DISCOVERY_ENABLED: { kind: "boolean", values: ["true", "false"] },
      NEGOTIATION_INCLUDE_OTHER_INTENTS: { kind: "enum", values: ["true", "false"] },
      NEGOTIATION_MAX_TURNS_CHAT: { kind: "integer" },
      NEGOTIATION_MAX_TURNS_AMBIENT: { kind: "integer" },
      NEGOTIATION_EVIDENCE_QUESTIONS_MODE: { kind: "enum", values: ["off", "shadow", "on"] },
      OUTCOME_QUESTIONS_MODE: { kind: "enum", values: ["off", "shadow", "on"] },
      POOL_QUESTIONS_MINING: { kind: "enum", values: ["off", "shadow"] },
      POOL_QUESTIONS_MODE: { kind: "enum", values: ["off", "on"] },
      POOL_QUESTIONS_PUSH: { kind: "enum", values: ["off", "on"] },
      POOL_QUESTIONS_RANKING: { kind: "enum", values: ["off", "on"] },
    };
    expect(Object.keys(expected).sort()).toEqual([...PROFILE_ENV_ALLOWLIST].sort());
    for (const [key, shape] of Object.entries(expected)) {
      const meta = byKey.get(key);
      expect(meta, `${key} missing`).toBeDefined();
      expect(meta!.kind).toBe(shape.kind);
      if (shape.values) expect(meta!.values).toEqual(shape.values);
    }
  });
});

describe("MODEL_METADATA", () => {
  it("covers exactly the selectable models, once each", () => {
    expect(MODEL_METADATA.map((m) => m.id).sort()).toEqual([...ALLOWED_CONFIG_MODELS].sort());
  });

  it("gives every model a label and blurb", () => {
    for (const meta of MODEL_METADATA) {
      expect(meta.label.trim().length).toBeGreaterThan(0);
      expect(meta.blurb.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("HARNESS_AGENT_METADATA", () => {
  it("keys are exactly the four ops harnesses", () => {
    expect(Object.keys(HARNESS_AGENT_METADATA).sort()).toEqual([...OPS_HARNESSES].sort());
  });

  it("lists exactly the agents each harness exercises, in registry order", () => {
    for (const harness of OPS_HARNESSES) {
      const registryAgents = HARNESS_REGISTRY[harness].agents;
      expect(HARNESS_AGENT_METADATA[harness].map((a) => a.id)).toEqual([...registryAgents]);
    }
  });

  it("premise lists the decomposer before the analyzer", () => {
    expect(HARNESS_AGENT_METADATA.premise.map((a) => a.id)).toEqual(["premiseDecomposer", "premiseAnalyzer"]);
  });

  it("gives every agent a label and role", () => {
    for (const harness of OPS_HARNESSES) {
      for (const agent of HARNESS_AGENT_METADATA[harness]) {
        expect(agent.label.trim().length).toBeGreaterThan(0);
        expect(agent.role.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("ops.metadata module boundary", () => {
  it("stays dependency-free so the browser bundle can import it", () => {
    const source = readFileSync(path.join(import.meta.dir, "..", "ops.metadata.ts"), "utf8");
    const importSpecifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const specifier of importSpecifiers) {
      expect(specifier).not.toMatch(/^node:/);
      expect(specifier).not.toMatch(/^(fs|crypto|path|os|util|stream)$/);
    }
    // Only relative imports of other dependency-free ops modules are allowed.
    for (const specifier of importSpecifiers) {
      expect(specifier).toMatch(/^\.\/ops\.(allowlist|registry|types)\.js$/);
    }
  });
});
