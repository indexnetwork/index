import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { PROFILE_ENV_ALLOWLIST } from "../ops.allowlist.js";
import { HARNESS_ENV_KEYS } from "../ops.envcatalog.js";
import { ALLOWED_CONFIG_MODELS } from "../ops.profiles.js";
import { HARNESS_REGISTRY, OPS_HARNESSES } from "../ops.registry.js";
import { FLAG_METADATA, ENV_FLAG_METADATA, HARNESS_AGENT_METADATA, MODEL_METADATA, envFlagValueIssue, type EnvFlagMeta } from "../ops.metadata.js";

/** Every key any harness offers, which is what "offered" means in the spec. */
const OFFERED_KEYS: readonly string[] = [...new Set(Object.values(HARNESS_ENV_KEYS).flat())].sort();

/**
 * Documented flags no harness reads — pinned exactly, not merely allowed.
 *
 * These are the IND-630 seven: catalogued because the live services read them,
 * unreachable from every harness entry point, and therefore never offered on
 * the launch form. They stay documented so a saved config can still record
 * them and the Configs page can say who reads them.
 *
 * An exact set rather than a permissive filter because this residue is where
 * an unoffered flag would hide: if a key stops being read by a harness it
 * lands here silently, and the launch form quietly loses a control that used
 * to work. Growing or shrinking this list has to be a deliberate edit.
 */
const READ_BY_NO_HARNESS: readonly string[] = [
  // Live discovery-on-behalf-of gate; reached from the introducer feature
  // module, which no harness entry point imports.
  "INTRODUCER_DISCOVERY_ENABLED",
  // Lens C. Read in the negotiation-evidence module, driven by API queues.
  "NEGOTIATION_EVIDENCE_QUESTIONS_MODE",
  // Lens B. Read in the outcome module, driven by explicit owner actions.
  "OUTCOME_QUESTIONS_MODE",
  // The four pool-question flags live in the discriminator module, whose entry
  // is a discovery-run completion hook rather than the graph itself.
  "POOL_QUESTIONS_MINING",
  "POOL_QUESTIONS_MODE",
  "POOL_QUESTIONS_PUSH",
  "POOL_QUESTIONS_RANKING",
].sort();

describe("ENV_FLAG_METADATA", () => {
  it("documents every key any harness offers", () => {
    // The spec's central rule: offered ⊆ documented. An undocumented key
    // renders as a bare SCREAMING_SNAKE string with no description and no
    // validation, which is exactly how DISCOVERY_PROFILE_SOURCE=user-context
    // reached a live A/B run and reported a difference that never existed.
    const documented = new Set(ENV_FLAG_METADATA.map((m) => m.key));
    const undocumented = OFFERED_KEYS.filter((key) => !documented.has(key));
    expect(undocumented, "offered but undocumented — write metadata or stop offering").toEqual([]);
  });

  it("documents each key exactly once", () => {
    const keys = ENV_FLAG_METADATA.map((m) => m.key);
    expect(new Set(keys).size, "a duplicated key makes envValueIssueForKey's find() order load-bearing").toBe(keys.length);
  });

  it("describes exactly the offered keys plus the pinned unread residue", () => {
    // The reverse direction, deliberately not total: metadata legitimately
    // describes flags no harness reads. Pinning the residue exactly means a
    // key silently dropping out of every catalogue fails here rather than
    // disappearing from the launch form unnoticed.
    const documented = ENV_FLAG_METADATA.map((m) => m.key);
    const unread = documented.filter((key) => !OFFERED_KEYS.includes(key)).sort();
    expect(unread).toEqual([...READ_BY_NO_HARNESS]);
  });

  it("keeps every allowlisted flag documented, so saved configs stay explainable", () => {
    const documented = new Set(ENV_FLAG_METADATA.map((m) => m.key));
    for (const key of PROFILE_ENV_ALLOWLIST) {
      expect(documented.has(key), `${key} is allowlisted but undocumented`).toBe(true);
    }
  });

  it("gives every flag a label, description, and defaultDescription", () => {
    for (const meta of ENV_FLAG_METADATA) {
      expect(meta.label.trim().length).toBeGreaterThan(0);
      expect(meta.description.trim().length).toBeGreaterThan(0);
      expect(meta.defaultDescription.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every enum, boolean and csv-enum flag explicit non-empty values", () => {
    for (const meta of ENV_FLAG_METADATA) {
      if (meta.kind === "enum" || meta.kind === "boolean" || meta.kind === "csv-enum") {
        expect(meta.values, `${meta.key} must declare values`).toBeDefined();
        expect(meta.values!.length).toBeGreaterThan(1);
      } else {
        expect(meta.values, `${meta.key} must not declare values`).toBeUndefined();
      }
    }
  });

  it("offers only reviewed models wherever a flag names one", () => {
    // Three flags carry a model id. Their read sites accept any string, so the
    // narrowing is the site's, not the code's: a browser-launched run must not
    // be able to name an unreviewed model through an env flag when the per-agent
    // pickers refuse exactly that. `none`/`off` are the fallback flag's own
    // documented disable words, read at model.config.ts's getFallbackModelName.
    const DISABLE_WORDS = ["none", "off"];
    for (const key of ["CHAT_MODEL", "SMARTEST_VERIFIER_MODEL", "OPENROUTER_FALLBACK_MODEL"]) {
      const meta = ENV_FLAG_METADATA.find((m) => m.key === key)!;
      expect(meta, `${key} missing`).toBeDefined();
      const modelValues = meta.values!.filter((v) => !DISABLE_WORDS.includes(v));
      expect([...modelValues].sort(), `${key} offers a model outside ALLOWED_CONFIG_MODELS`)
        .toEqual([...ALLOWED_CONFIG_MODELS].sort());
    }
  });

  it("refuses every EVAL_MODEL_OVERRIDES value its read site would throw on", () => {
    // readModelOverrides throws on each of these, lazily, at first model
    // construction — i.e. after the branches are reset and the run is spending.
    // Refusing them here is what turns that crash into a launch-time message.
    const meta = ENV_FLAG_METADATA.find((m) => m.key === "EVAL_MODEL_OVERRIDES")!;
    const bounds = { agents: ["opportunityEvaluator"], models: [...ALLOWED_CONFIG_MODELS] };
    expect(envFlagValueIssue(meta, "{not json", bounds)).not.toBeNull();
    expect(envFlagValueIssue(meta, "[]", bounds)).not.toBeNull();
    expect(envFlagValueIssue(meta, "\"a string\"", bounds)).not.toBeNull();
    expect(envFlagValueIssue(meta, '{"noSuchAgent":"google/gemini-2.5-flash"}', bounds)).not.toBeNull();
    expect(envFlagValueIssue(meta, '{"opportunityEvaluator":""}', bounds)).not.toBeNull();
    expect(envFlagValueIssue(meta, '{"opportunityEvaluator":7}', bounds)).not.toBeNull();
    // Accepted by the read site, refused by the site: an unreviewed model.
    expect(envFlagValueIssue(meta, '{"opportunityEvaluator":"some/unreviewed-model"}', bounds)).not.toBeNull();
    expect(envFlagValueIssue(meta, '{"opportunityEvaluator":"google/gemini-2.5-flash"}', bounds)).toBeNull();
  });

  it("pins the read site's rules for EVAL_MODEL_OVERRIDES, so a rewrite there fails here", () => {
    const source = readFileSync(
      path.join(import.meta.dir, "..", "..", "..", "src", "shared", "agent", "model.config.ts"),
      "utf8",
    );
    expect(source).toContain("EVAL_MODEL_OVERRIDES is not valid JSON");
    expect(source).toContain("EVAL_MODEL_OVERRIDES must be a JSON object of agent -> model id");
    expect(source).toContain("names an unknown agent");
    expect(source).toContain("must be a non-empty model id string");
  });

  it("documents that EVAL_MODEL_OVERRIDES outranks CHAT_MODEL, because it does", () => {
    // Both flags can set the chat agent's model, and the launch form's per-agent
    // pickers write EVAL_MODEL_OVERRIDES — so an operator can set both and see
    // only one take effect. Verified against the read site rather than assumed:
    // getBaseModelConfig seeds chat.model from CHAT_MODEL, then getModelConfig
    // applies the overrides map over the result.
    const source = readFileSync(
      path.join(import.meta.dir, "..", "..", "..", "src", "shared", "agent", "model.config.ts"),
      "utf8",
    );
    expect(source, "CHAT_MODEL is no longer the base for the chat agent")
      .toContain("process.env.CHAT_MODEL");
    expect(source, "overrides are no longer applied over the base config")
      .toMatch(/const base = getBaseModelConfig\(config\);\s*\n\s*const overrides = readModelOverrides/);
    expect(source, "EVAL_MODEL_OVERRIDES is no longer production-inert")
      .toContain('if (process.env.NODE_ENV === "production") return {};');

    const chat = ENV_FLAG_METADATA.find((m) => m.key === "CHAT_MODEL")!;
    const overrides = ENV_FLAG_METADATA.find((m) => m.key === "EVAL_MODEL_OVERRIDES")!;
    expect(chat.description).toContain("EVAL_MODEL_OVERRIDES");
    expect(overrides.description).toContain("CHAT_MODEL");
    expect(overrides.description).toContain("production");
  });

  it("declares a minimum only where a number can be given and where it would be honoured", () => {
    // A `min` on a kind envFlagValueIssue does not range-check would be a bound
    // that reads as enforced and enforces nothing.
    for (const meta of ENV_FLAG_METADATA) {
      if (meta.min === undefined) continue;
      expect(["integer", "number", "decimal-range"], `${meta.key} declares min on kind ${meta.kind}`).toContain(meta.kind);
    }
  });

  it("declares a maximum only where it would be honoured, and above its own minimum", () => {
    for (const meta of ENV_FLAG_METADATA) {
      if (meta.max === undefined) continue;
      expect(["integer", "number", "decimal-range"], `${meta.key} declares max on kind ${meta.kind}`).toContain(meta.kind);
      if (meta.min !== undefined) expect(meta.max, `${meta.key} max is below its min`).toBeGreaterThan(meta.min);
    }
  });

  it("enforces both ends of the negotiator turn timeout, matching AbortSignal's range", () => {
    // The upper bound is not decoration: the read site calls
    // AbortSignal.timeout(N), which throws above Number.MAX_SAFE_INTEGER, so a
    // value like 1e30 passes Number.isFinite and then crashes the turn.
    const agent = readFileSync(
      path.join(import.meta.dir, "..", "..", "..", "src", "negotiation", "application", "negotiation.agent.ts"),
      "utf8",
    );
    expect(agent, "turn timeout no longer bounded by MAX_SAFE_INTEGER").toContain("n <= Number.MAX_SAFE_INTEGER");
    expect(agent, "turn timeout no longer rejects zero").toContain("n > 0");
    const meta = ENV_FLAG_METADATA.find((m) => m.key === "NEGOTIATOR_TURN_TIMEOUT_MS")!;
    expect(meta.min).toBe(1);
    expect(meta.max).toBe(Number.MAX_SAFE_INTEGER);
    expect(envFlagValueIssue(meta, "0")).not.toBeNull();
    expect(envFlagValueIssue(meta, String(Number.MAX_SAFE_INTEGER + 10))).not.toBeNull();
    expect(envFlagValueIssue(meta, "15000")).toBeNull();
  });

  it.each([
    ["DISCOVERY_MIN_SIMILARITY", 0, 1, "0.30"],
    ["DISCOVERY_EVALUATOR_MIN_SCORE", 0, 100, "50"],
  ] as const)("mirrors %s strict decimal grammar and inclusive range", (key, min, max, defaultValue) => {
    const meta = ENV_FLAG_METADATA.find((candidate) => candidate.key === key)!;
    expect(meta, `${key} metadata`).toBeDefined();
    expect(meta.kind).toBe("decimal-range");
    expect(meta.min).toBe(min);
    expect(meta.max).toBe(max);
    expect(meta.defaultDescription).toContain(defaultValue);

    for (const value of [String(min), `+${min}`, ".5", String(max), `${max}.0`]) {
      expect(envFlagValueIssue(meta, value), `${key} should accept ${value}`).toBeNull();
    }
    for (const value of ["-0", "-0.1", "1e0", "0x1", "NaN", "Infinity", "1.2.3", String(max + 0.01)]) {
      expect(envFlagValueIssue(meta, value), `${key} should refuse ${value}`).not.toBeNull();
    }
  });

  it("lets the retry count be zero, because its read site honours zero", () => {
    // The negotiation turn caps refuse 0 because `Number(x) || d` turns it into
    // the default. This one is `Number.isFinite(n) && n >= 0`, so 0 really is
    // "no retries" — copying the other bound here would refuse a legal value.
    const source = readFileSync(
      path.join(import.meta.dir, "..", "..", "..", "src", "shared", "agent", "model.config.ts"),
      "utf8",
    );
    expect(source, "OPENROUTER_MAX_RETRIES no longer accepts 0").toContain("retriesEnv >= 0");
    const meta = ENV_FLAG_METADATA.find((m) => m.key === "OPENROUTER_MAX_RETRIES")!;
    expect(meta.min).toBe(0);
    expect(envFlagValueIssue(meta, "0")).toBeNull();
  });

  it("bounds the negotiation turn caps away from the value that silently means the default", () => {
    // Both are read as `Number(env) || <default>`, so 0 is not "no turns": it is
    // the default, chosen by a fallback the operator never asked for. The bound
    // is derived from that read, so a read site that stops falling back fails here.
    const graph = readFileSync(
      path.join(import.meta.dir, "..", "..", "..", "src", "opportunity", "application", "opportunity.graph.ts"),
      "utf8",
    );
    const byKey = new Map(ENV_FLAG_METADATA.map((m) => [m.key, m]));
    for (const [key, fallback] of [["NEGOTIATION_MAX_TURNS_CHAT", "4"], ["NEGOTIATION_MAX_TURNS_AMBIENT", "6"]] as const) {
      expect(graph, `${key} is no longer read with a || fallback`).toContain(`Number(process.env.${key}) || ${fallback}`);
      expect(byKey.get(key)!.min, `${key} must refuse the values that fall back`).toBe(1);
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

  // Flags startup.env.ts declares as free text but the protocol parses as a
  // closed set at the use site. The metadata must describe the USE SITE, not the
  // startup schema: an unrecognised value is never refused at runtime, it warns
  // once and falls back, so "any string" here would let an operator configure a
  // side of an A/B run that silently runs the default. Values are derived from
  // the use site's own source, so widening or renaming them fails here.
  const USE_SITE_NARROWED_FLAGS: Record<string, {
    kind: EnvFlagMeta["kind"];
    useSite: string;
    /** Captures the group holding the quoted values the use site accepts. */
    valuesFrom: RegExp;
  }> = {
    DISCOVERY_ALLOWED_TYPES: {
      kind: "csv-enum",
      useSite: "../../../src/opportunity/discovery.env.ts",
      valuesFrom: /const VALID_TOKENS: [^=]+= new Set\(\[([^\]]+)\]\)/,
    },
    DISCOVERY_PROFILE_SOURCE: {
      kind: "enum",
      useSite: "../../../src/opportunity/discovery.env.ts",
      valuesFrom: /export type DiscoveryProfileSource = ([^;]+);/,
    },
  };

  /**
   * Flags whose offerable values the site narrows below what the startup schema
   * and the read site both accept.
   *
   * Each of these is `z.string()` upstream and any-string at the read site, so
   * neither source can supply a value list. The narrowing is a site policy, not
   * a mirror of the code: a run launched from a browser may only name a
   * reviewed model, exactly as validateConfigOverrides already requires of the
   * per-agent pickers. Pinned by the "offers only reviewed models" test above
   * rather than here, and excluded from the mirror so it does not demand a
   * value list the sources do not have.
   */
  const SITE_NARROWED_MODEL_FLAGS = ["CHAT_MODEL", "SMARTEST_VERIFIER_MODEL", "OPENROUTER_FALLBACK_MODEL"];

  /**
   * Documented flags the API startup schema does not declare at all.
   *
   * EVAL_MODEL_OVERRIDES is declared there but as free text, and its shape is
   * a JSON object no zod string schema describes; its rules are pinned directly
   * against readModelOverrides by the tests above.
   */
  const NOT_IN_STARTUP_SCHEMA = [...SITE_NARROWED_MODEL_FLAGS, "EVAL_MODEL_OVERRIDES"];

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
    let pinnedFromUseSite = 0;

    // Every documented flag, not just the sixteen the hand-written allowlist
    // names: the eighteen keys the derived catalogue added are declared in the
    // same startup schema and must be mirrored by the same rule. Checking only
    // the allowlist would leave the newly offered flags unpinned, which is the
    // state that let a fallback-on-typo flag reach a live run.
    const MIRRORED_KEYS = ENV_FLAG_METADATA.map((m) => m.key).filter((key) => !NOT_IN_STARTUP_SCHEMA.includes(key));

    for (const key of MIRRORED_KEYS) {
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

      const declaration = /^optional[A-Za-z]*$/.test(declared[1]!.trim())
        ? aliasOf(declared[1]!.trim())
        : declared[1]!;

      const narrowed = USE_SITE_NARROWED_FLAGS[key];
      if (narrowed !== undefined) {
        // The narrowing entry is only justified while upstream really is the
        // looser one; once startup.env.ts states the values itself, the entry is
        // stale and the schema branch below should own the flag again.
        expect(enumMembersOf(declaration), `${key} states its values upstream now; drop its narrowing entry`).toBeUndefined();
        expect(declaration, `${key} is no longer free text upstream`).toContain("z.string()");
        expect(meta!.kind, `${key} kind`).toBe(narrowed.kind);

        const useSiteSource = readFileSync(path.join(import.meta.dir, narrowed.useSite), "utf8");
        expect(useSiteSource, `${key} not read at its declared use site`).toContain(`process.env.${key}`);
        const captured = useSiteSource.match(narrowed.valuesFrom);
        expect(captured, `${key}: valuesFrom matched nothing in ${narrowed.useSite}`).not.toBeNull();
        const useSiteValues = [...captured![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
        // Guards the pin against passing vacuously on an unparsed match.
        expect(useSiteValues.length, `${key}: no values parsed from the use site`).toBeGreaterThan(1);
        expect([...meta!.values!].sort(), `${key} values drifted from ${narrowed.useSite}`).toEqual(
          [...useSiteValues].sort(),
        );
        pinnedFromUseSite += 1;
        continue;
      }

      pinnedFromSchema += 1;
      const upstreamValues = enumMembersOf(declaration);
      if (upstreamValues) {
        // Enum/boolean: our offerable values must be exactly upstream's.
        expect([...meta!.values!].sort(), `${key} values drifted from startup.env.ts`).toEqual(
          [...upstreamValues].sort(),
        );
        expect(meta!.kind === "enum" || meta!.kind === "boolean").toBe(true);
      } else if (/^optionalDecimalInRange\(/.test(declaration.trim())) {
        expect(meta!.kind, `${key} should use the strict decimal range validator`).toBe("decimal-range");
      } else if (/regex\(\/\^\\d\+\$\//.test(declaration)) {
        expect(meta!.kind, `${key} should be integer`).toBe("integer");
      } else {
        expect(meta!.kind, `${key} should be free-text`).toBe("string");
      }
    }

    // Guard the guard: if the regexes stop matching, this test must not silently
    // pass having pinned nothing.
    expect(pinnedFromUseSite).toBe(Object.keys(USE_SITE_NARROWED_FLAGS).length);
    expect(pinnedFromSchema).toBe(
      MIRRORED_KEYS.length
      - Object.keys(USE_SITE_ONLY_FLAGS).length
      - Object.keys(USE_SITE_NARROWED_FLAGS).length,
    );
    // The mirror must actually cover the flags this task added, not just the
    // original sixteen; without this the loop could silently shrink.
    for (const added of ["NEGOTIATOR_STANCE", "NEGOTIATION_SCREEN_MODE", "CHAT_REASONING_EFFORT", "OPENROUTER_MAX_RETRIES"]) {
      expect(MIRRORED_KEYS, `${added} dropped out of the mirror`).toContain(added);
    }
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
