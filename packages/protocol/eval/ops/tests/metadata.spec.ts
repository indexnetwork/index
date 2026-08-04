import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PROFILE_ENV_ALLOWLIST } from "../ops.allowlist.js";
import { ALLOWED_CONFIG_MODELS } from "../ops.profiles.js";
import { HARNESS_REGISTRY, OPS_HARNESSES } from "../ops.registry.js";
import { FLAG_METADATA, ENV_FLAG_METADATA, HARNESS_AGENT_METADATA, MODEL_METADATA, type EnvFlagMeta } from "../ops.metadata.js";

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

  // Flags the API startup schema does not declare, because the protocol reads
  // them directly at the use site. Each must name the file that reads it, so a
  // moved/renamed use site fails here instead of leaving the entry unpinned.
  const USE_SITE_ONLY_FLAGS: Record<string, { kind: EnvFlagMeta["kind"]; useSite: string }> = {
    DISCOVERY_REJECTION_COOLDOWN_DAYS: {
      kind: "number",
      useSite: "../../../src/opportunity/application/opportunity.graph.ts",
    },
  };

  it("mirrors the real startup.env.ts schemas — upstream widening fails here", () => {
    // A hand-copied table compared against another hand-copied table proves
    // nothing: validateProfileEnv HARD-REJECTS on ENV_FLAG_METADATA, so if
    // upstream widens an enum (POOL_QUESTIONS_MODE gains 'shadow') the API and
    // the guided editor would refuse a value the live service accepts. Parse the
    // real source instead. Same text-pin pattern as fixture.spec.ts.
    const source = readFileSync(
      path.join(import.meta.dir, "..", "..", "..", "..", "..", "services", "api", "src", "startup.env.ts"),
      "utf8",
    );

    // Resolve the shared aliases (optionalInt, optionalBoolean, ...) from their
    // real definitions rather than assuming their shape.
    const aliasOf = (name: string): string => {
      const match = source.match(new RegExp(`const ${name} = (.+);`));
      if (!match) throw new Error(`alias ${name} not found in startup.env.ts`);
      return match[1]!;
    };
    const enumMembersOf = (declaration: string): string[] | undefined => {
      const enumMatch = declaration.match(/z\.enum\(\[([^\]]+)\]\)/);
      if (enumMatch) return enumMatch[1]!.split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
      // z.union of z.literal()s, e.g. DISCOVERY_CONTEXT_TO_INTENT — '' is the
      // "unset" literal and is not an offerable value.
      const literals = [...declaration.matchAll(/z\.literal\('([^']*)'\)/g)].map((m) => m[1]!);
      const offerable = literals.filter((value) => value !== "");
      return offerable.length > 0 ? offerable : undefined;
    };

    const byKey = new Map(ENV_FLAG_METADATA.map((m) => [m.key, m]));
    let pinnedFromSchema = 0;

    for (const key of PROFILE_ENV_ALLOWLIST) {
      const meta = byKey.get(key);
      expect(meta, `${key} missing from ENV_FLAG_METADATA`).toBeDefined();

      const declared = source.match(new RegExp(`^  ${key}: (.+),$`, "m"));
      if (!declared) {
        // Not in the startup schema: must be an explicitly registered use-site flag.
        const useSiteOnly = USE_SITE_ONLY_FLAGS[key];
        expect(useSiteOnly, `${key} is in neither startup.env.ts nor USE_SITE_ONLY_FLAGS`).toBeDefined();
        expect(meta!.kind).toBe(useSiteOnly!.kind);
        const useSiteSource = readFileSync(path.join(import.meta.dir, useSiteOnly!.useSite), "utf8");
        expect(useSiteSource, `${key} not read at its declared use site`).toContain(`process.env.${key}`);
        continue;
      }

      pinnedFromSchema += 1;
      const declaration = /^optional[A-Za-z]*$/.test(declared[1]!.trim())
        ? aliasOf(declared[1]!.trim())
        : declared[1]!;

      const upstreamValues = enumMembersOf(declaration);
      if (upstreamValues) {
        // Enum/boolean: our offerable values must be exactly upstream's.
        expect([...meta!.values!].sort(), `${key} values drifted from startup.env.ts`).toEqual(
          [...upstreamValues].sort(),
        );
        expect(meta!.kind === "enum" || meta!.kind === "boolean").toBe(true);
      } else if (/regex\(\/\^\\d\+\$\//.test(declaration)) {
        expect(meta!.kind, `${key} should be integer`).toBe("integer");
      } else {
        expect(meta!.kind, `${key} should be free-text`).toBe("string");
      }
    }

    // Guard the guard: if the regexes stop matching, this test must not silently
    // pass having pinned nothing.
    expect(pinnedFromSchema).toBe(PROFILE_ENV_ALLOWLIST.length - Object.keys(USE_SITE_ONLY_FLAGS).length);
  });
});

describe("FLAG_METADATA", () => {
  it("covers exactly the flags the registry can expose, with no extras", () => {
    const registryFlags = new Set(
      Object.values(HARNESS_REGISTRY).flatMap((descriptor) => descriptor.flags.map((flag) => flag.name)),
    );
    const documented = new Set(FLAG_METADATA.map((flag) => flag.name));
    expect([...documented].sort()).toEqual([...registryFlags].sort());
  });

  it("classifies every flag that decides which cases run as selection", () => {
    // A selection difference makes two runs incomparable (compareArtifacts
    // refuses), so these must never become per-side controls in the A/B form.
    for (const name of ["runs", "case", "rule", "tier"]) {
      expect(FLAG_METADATA.find((flag) => flag.name === name)?.scope, `${name} scope`).toBe("selection");
    }
    for (const name of ["noJudge", "alpha", "strictEvidence", "attemptTimeoutMs"]) {
      expect(FLAG_METADATA.find((flag) => flag.name === name)?.scope, `${name} scope`).toBe("scoring");
    }
  });

  it("gives every flag non-empty copy", () => {
    for (const flag of FLAG_METADATA) {
      expect(flag.label.length, `${flag.name} label`).toBeGreaterThan(0);
      expect(flag.description.length, `${flag.name} description`).toBeGreaterThan(20);
      expect(flag.defaultLabel.length, `${flag.name} defaultLabel`).toBeGreaterThan(0);
    }
  });
});

describe("copy honesty spot checks", () => {
  it("describes the rejection cooldown as a soft ranking penalty, matching opportunity.graph.ts", () => {
    const flag = ENV_FLAG_METADATA.find((f) => f.key === "DISCOVERY_REJECTION_COOLDOWN_DAYS");
    expect(flag).toBeDefined();
    // The code applies a ×0.5 similarity penalty to rejected OR stalled candidates
    // (opportunity.graph.ts IND-567) — the copy must not claim suppression/removal.
    expect(flag!.description).toContain("penalty");
    expect(flag!.description).toContain("stalled");
    expect(flag!.description).not.toContain("stays suppressed");
    expect(flag!.defaultDescription).toBe("7 days");
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
  it("keys are exactly the registered harnesses", () => {
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
