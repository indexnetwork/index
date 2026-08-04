import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { renderRun, RunSpecSchema } from "../ops.argv.js";
import { resolveProfile } from "../ops.profiles.js";
import { HARNESS_REGISTRY, OPS_HARNESSES } from "../ops.registry.js";
import type { OpsHarness } from "../ops.types.js";

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
        { kind: "eval", harness: "discovery-ab", profile: "default", flags: { tier: 1 } },
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

  it("declared numeric flag bounds are accepted by RunSpecSchema", () => {
    // Every (harness, numeric flag) pair, not one representative per flag name:
    // discovery-ab narrows --runs to its own ceiling, so a per-name check would
    // never look at it.
    const numericFlags: { harness: (typeof OPS_HARNESSES)[number]; name: string; min: number; max: number }[] = [];
    for (const harness of OPS_HARNESSES) {
      for (const flag of HARNESS_REGISTRY[harness].flags) {
        if (flag.kind === "number") {
          numericFlags.push({ harness, name: flag.name, min: flag.min!, max: flag.max! });
        }
      }
    }

    // Test each numeric flag's bounds
    for (const { harness, name, ...bounds } of numericFlags) {
      // Schema should ACCEPT the declared min and max
      const atMin = { kind: "eval" as const, harness, profile: "default", flags: { [name]: bounds.min } };
      const atMax = { kind: "eval" as const, harness, profile: "default", flags: { [name]: bounds.max } };
      expect(() => RunSpecSchema.parse(atMin)).not.toThrow();
      expect(() => RunSpecSchema.parse(atMax)).not.toThrow();

      // Schema should REJECT just outside the declared bounds
      // For alpha (0.001..0.999), test that the server's gt(0).lt(1) would accept
      // slightly outside but the registry bounds are deliberately narrower.
      if (name === "alpha") {
        // 0.0005 and 0.9995 would pass the server's gt(0).lt(1) but should fail
        // the registry's narrower 0.001..0.999 bounds at step resolution.
        const belowMin = { kind: "eval" as const, harness, profile: "default", flags: { alpha: 0.0005 } };
        const aboveMax = { kind: "eval" as const, harness, profile: "default", flags: { alpha: 0.9995 } };
        // The schema uses gt(0).lt(1), so these actually pass the schema.
        // What we're asserting is that the REGISTRY bounds are narrower (safer).
        expect(() => RunSpecSchema.parse(belowMin)).not.toThrow();
        expect(() => RunSpecSchema.parse(aboveMax)).not.toThrow();
        // But 0 and 1 fail the schema:
        expect(() => RunSpecSchema.parse({ kind: "eval" as const, harness, profile: "default", flags: { alpha: 0 } })).toThrow();
        expect(() => RunSpecSchema.parse({ kind: "eval" as const, harness, profile: "default", flags: { alpha: 1 } })).toThrow();
      } else if (name === "runs" && harness === "discovery-ab") {
        // The registry ceiling here (AB_MAX_REPETITIONS) is deliberately below
        // the schema's 25, so the form refuses what the engine would refuse.
        // The schema still accepts up to 25 for this harness today; assert the
        // direction rather than pretending otherwise.
        expect(bounds.max).toBeLessThan(25);
        expect(() =>
          RunSpecSchema.parse({ kind: "eval" as const, harness, profile: "default", flags: { runs: 26 } }),
        ).toThrow();
      } else {
        // For runs, tier, attemptTimeoutMs: test just outside the bounds
        const belowMin = { kind: "eval" as const, harness, profile: "default", flags: { [name]: bounds.min - 1 } };
        const aboveMax = { kind: "eval" as const, harness, profile: "default", flags: { [name]: bounds.max + 1 } };
        expect(() => RunSpecSchema.parse(belowMin)).toThrow();
        expect(() => RunSpecSchema.parse(aboveMax)).toThrow();
      }
    }
  });
});
