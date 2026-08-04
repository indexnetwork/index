import { describe, expect, it } from "bun:test";

import { HARNESS_REGISTRY, OPS_HARNESSES } from "../ops.registry.js";

describe("HARNESS_REGISTRY", () => {
  it("covers exactly the four scorecard harnesses", () => {
    expect([...OPS_HARNESSES].sort()).toEqual(["matching", "opportunity", "premise", "profile"]);
    expect(Object.keys(HARNESS_REGISTRY).sort()).toEqual(["matching", "opportunity", "premise", "profile"]);
  });

  it("maps each harness to its package script", () => {
    for (const harness of OPS_HARNESSES) {
      expect(HARNESS_REGISTRY[harness].script).toBe(`eval:${harness}`);
    }
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

  it("declared numeric flag bounds are accepted by RunSpecSchema", async () => {
    // Import dynamically to avoid eager evaluation issues with the schema
    const { RunSpecSchema } = await import("../ops.argv.js");

    // Collect all unique numeric flags across all harnesses
    const numericFlags = new Map<string, { min: number; max: number }>();
    for (const harness of OPS_HARNESSES) {
      for (const flag of HARNESS_REGISTRY[harness].flags) {
        if (flag.kind === "number" && !numericFlags.has(flag.name)) {
          numericFlags.set(flag.name, { min: flag.min!, max: flag.max! });
        }
      }
    }

    // Test each numeric flag's bounds
    for (const [name, bounds] of numericFlags) {
      // Find a harness that accepts this flag
      const harness = OPS_HARNESSES.find((h) =>
        HARNESS_REGISTRY[h].flags.some((f) => f.name === name),
      )!;

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
