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
});
