import { describe, it, expect } from "bun:test";
import { getPreset } from "../questioner.presets.js";

describe("getPreset", () => {
  it("returns the discovery preset with systemPrompt and buildPrompt", () => {
    const preset = getPreset("discovery");
    expect(preset).toBeDefined();
    expect(typeof preset.systemPrompt).toBe("string");
    expect(preset.systemPrompt.length).toBeGreaterThan(0);
    expect(typeof preset.buildPrompt).toBe("function");
  });

  it("discovery buildPrompt produces a string containing the query", () => {
    const preset = getPreset("discovery");
    const result = preset.buildPrompt({
      query: "looking for ML engineers",
      sourceProfile: { name: "Alice" },
      negotiationDigests: [],
      summary: {
        totalCandidates: 5,
        opportunitiesFound: 2,
        noOpportunityCount: 3,
        timeoutCount: 1,
        roleDistribution: {},
      },
      now: "2026-05-24T12:00:00.000Z",
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("looking for ML engineers");
    expect(result).toContain("Alice");
  });

  it("throws for an unimplemented mode", () => {
    expect(() => getPreset("intent")).toThrow("not implemented");
    expect(() => getPreset("profile")).toThrow("not implemented");
    expect(() => getPreset("negotiation")).toThrow("not implemented");
  });
});
