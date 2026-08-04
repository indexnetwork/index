import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { renderRun, RunSpecSchema } from "../ops.argv.js";
import { resolveProfile } from "../ops.profiles.js";
import { HARNESS_REGISTRY, OPS_HARNESSES } from "../ops.registry.js";
import type { OpsHarness } from "../ops.types.js";

/**
 * discovery-ab is the one harness whose spec is invalid without per-side
 * configuration, so a spec built for it here carries a valid minimal pair;
 * otherwise every parse below would fail for a reason the test is not about.
 */
function specFor(harness: OpsHarness, flags: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: "eval" as const,
    harness,
    profile: "default",
    flags,
    ...(harness === "discovery-ab"
      ? { sides: { a: { DISCOVERY_PROFILE_SOURCE: "premise" }, b: { DISCOVERY_PROFILE_SOURCE: "user_context" } } }
      : {}),
  };
}

const AB_CONTRACT_SOURCE = path.join(
  import.meta.dir, "..", "..", "..", "..", "..",
  "services", "api", "src", "cli", "discovery-ab.contract.ts",
);

describe("HARNESS_REGISTRY", () => {
  it("covers the four scorecard harnesses plus discovery-ab", () => {
    const expected: OpsHarness[] = ["discovery-ab", "matching", "opportunity", "premise", "profile"];
    expect([...OPS_HARNESSES].sort()).toEqual(expected);
    expect(Object.keys(HARNESS_REGISTRY).sort()).toEqual(expected);
  });

  it("maps each harness to its package script", () => {
    for (const harness of OPS_HARNESSES) {
      expect(HARNESS_REGISTRY[harness].script).toBe(`eval:${harness}`);
    }
  });

  it("declares a cwd only for the harness whose script is not in packages/protocol", () => {
    // An unset cwd means packages/protocol. discovery-ab's script lives in
    // services/api/package.json, so running it from the default directory would
    // fail with "script not found" rather than doing anything.
    expect(HARNESS_REGISTRY["discovery-ab"].cwd).toBe("services/api");
    for (const harness of OPS_HARNESSES.filter((h) => h !== "discovery-ab")) {
      expect(HARNESS_REGISTRY[harness].cwd).toBeUndefined();
    }
  });

  it("offers discovery-ab only the two flags its parser reads", () => {
    // The engine's parser reads --case, --runs, --a, --b, --report and --force.
    // It does not refuse the rest: it scans for the flags it knows and ignores
    // everything else, so a selectable flag beyond these two would be dropped in
    // silence rather than failing loudly. --a/--b are per-side configuration
    // (not a HarnessFlag) and --report/--force are supplied by the server.
    expect(HARNESS_REGISTRY["discovery-ab"].flags.map((f) => f.cli)).toEqual(["--runs", "--case"]);
  });

  it("pins discovery-ab's run bounds to the engine's own constants", () => {
    // Hand-copied bounds drift. Read the real constants: if the engine lowers
    // its ceiling, a form built from this registry must not keep offering the
    // old one, because the engine refuses it (exit 2) after the operator has
    // already confirmed the workload.
    const source = readFileSync(AB_CONTRACT_SOURCE, "utf8");
    const constantOf = (name: string): number => {
      const match = source.match(new RegExp(`export const ${name} = (\\d+);`));
      if (!match) throw new Error(`${name} not found in discovery-ab.contract.ts`);
      return Number(match[1]);
    };

    const runs = HARNESS_REGISTRY["discovery-ab"].flags.find((f) => f.name === "runs")!;
    expect(runs.max).toBe(constantOf("AB_MAX_REPETITIONS"));
    expect(HARNESS_REGISTRY["discovery-ab"].defaultRuns).toBe(constantOf("AB_DEFAULT_REPETITIONS"));
  });

  it("refuses to render a flag discovery-ab does not accept", () => {
    // The engine ignores what it does not recognise, so nothing downstream would
    // report a flag this entry offered by mistake: the run would simply not be
    // the run the operator configured. renderRun is the last place that can
    // refuse, and it refuses against this entry's flag list — so widening the
    // list widens what argv can carry, and this fails the moment it does.
    const resolved = resolveProfile({ name: "default", description: "d", models: {}, env: {} });
    expect(() =>
      renderRun(
        {
          kind: "eval",
          harness: "discovery-ab",
          profile: "default",
          flags: { tier: 1 },
          // Valid sides, so the only thing wrong with this spec is the flag.
          sides: { a: { DISCOVERY_PROFILE_SOURCE: "premise" }, b: { DISCOVERY_PROFILE_SOURCE: "user_context" } },
        },
        resolved,
        "/tmp/.ops-runs/run-1/report.json",
      ),
    ).toThrow(/does not accept --tier/);
  });

  it("never exposes a destructive flag", () => {
    const destructive = ["--update-baseline", "--force", "--reason", "--report", "--html", "--no-save"];
    for (const harness of OPS_HARNESSES) {
      for (const flag of HARNESS_REGISTRY[harness].flags) {
        expect(destructive).not.toContain(flag.cli);
      }
    }
  });

  it("only offers --tier on matching", () => {
    const hasTier = (h: (typeof OPS_HARNESSES)[number]) =>
      HARNESS_REGISTRY[h].flags.some((f) => f.name === "tier");
    expect(hasTier("matching")).toBe(true);
    expect(hasTier("premise")).toBe(false);
  });

  it("declared numeric flag bounds are exactly what RunSpecSchema accepts", () => {
    // Every (harness, numeric flag) pair, not one representative per flag name:
    // discovery-ab narrows --runs to its own ceiling, so a per-name check would
    // never look at it.
    //
    // This used to have two exceptions, both recording a schema that was WIDER
    // than the registry: --alpha 0.0005 parsed (the schema says gt(0), every
    // registry entry says 0.001) and discovery-ab --runs 25 parsed (the schema
    // says 25, that registry entry says 10 — AB_MAX_REPETITIONS). Both were
    // authorisations of a run the engine refuses, so RunSpecSchema now enforces
    // each harness's own bounds (flagValueIssues, ops.flags.ts) and there is no
    // longer a direction to assert instead of a refusal.
    const numericFlags: { harness: (typeof OPS_HARNESSES)[number]; name: string; min: number; max: number; step: number }[] = [];
    for (const harness of OPS_HARNESSES) {
      for (const flag of HARNESS_REGISTRY[harness].flags) {
        if (flag.kind === "number") {
          numericFlags.push({ harness, name: flag.name, min: flag.min!, max: flag.max!, step: flag.step ?? 1 });
        }
      }
    }
    expect(numericFlags.length).toBeGreaterThan(0);

    for (const { harness, name, ...bounds } of numericFlags) {
      // The declared bounds are inside: a form built from this registry puts them
      // on its inputs, so a refused bound would offer a value that cannot launch.
      expect(() => RunSpecSchema.parse(specFor(harness, { [name]: bounds.min })), `${harness} ${name} min`).not.toThrow();
      expect(() => RunSpecSchema.parse(specFor(harness, { [name]: bounds.max })), `${harness} ${name} max`).not.toThrow();

      // And one step outside either bound is refused, at the step resolution the
      // registry declares — which is how --alpha's exclusive server bounds are
      // expressed as inclusive ones.
      expect(() => RunSpecSchema.parse(specFor(harness, { [name]: bounds.min - bounds.step })), `${harness} ${name} below min`).toThrow();
      expect(() => RunSpecSchema.parse(specFor(harness, { [name]: bounds.max + bounds.step })), `${harness} ${name} above max`).toThrow();
    }

    // The pair that motivated the change, stated once in full: this harness's
    // ceiling is below the shared schema's, and the schema now honours it.
    const abRuns = HARNESS_REGISTRY["discovery-ab"].flags.find((flag) => flag.name === "runs")!;
    expect(abRuns.max).toBeLessThan(25);
    expect(() => RunSpecSchema.parse(specFor("discovery-ab", { runs: 25 }))).toThrow(/--runs/);
    expect(() => RunSpecSchema.parse(specFor("matching", { runs: 25 }))).not.toThrow();
  });
});
