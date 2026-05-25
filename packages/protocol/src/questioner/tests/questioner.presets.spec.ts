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
    expect(() => getPreset("profile")).toThrow("not implemented");
    expect(() => getPreset("negotiation")).toThrow("not implemented");
  });
});

describe("intent preset", () => {
  it("returns the intent preset with systemPrompt and buildPrompt", () => {
    const preset = getPreset("intent");
    expect(preset).toBeDefined();
    expect(typeof preset.systemPrompt).toBe("string");
    expect(preset.systemPrompt.length).toBeGreaterThan(0);
    expect(typeof preset.buildPrompt).toBe("function");
  });

  it("intent buildPrompt produces a string containing the intent payload", () => {
    const preset = getPreset("intent");
    const result = preset.buildPrompt({
      intentId: "intent-1",
      payload: "I want to find a cofounder for my AI startup",
      userProfile: { name: "Alice", bio: "AI researcher" },
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("cofounder");
    expect(result).toContain("Alice");
  });
});
