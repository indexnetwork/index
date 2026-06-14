import { describe, it, expect } from "bun:test";
import { getPreset } from "../questioner.presets.js";

const standaloneModeExpectations = [
  {
    mode: "discovery" as const,
    anchors: ["original query", "discovery pattern", "negotiation pattern", "concrete learned fact"],
    positiveExample: "For your AI crypto decentralized deep-tech search",
    negativeExample: "Which area is most critical right now?",
  },
  {
    mode: "intent" as const,
    anchors: ["source intent/topic", "intent or summary"],
    positiveExample: "For your decentralized identity protocol-design search",
    negativeExample: "What kind of collaboration are you looking for?",
  },
  {
    mode: "profile" as const,
    anchors: ["profile signal or gap", "current profile", "existing premises", "identified gaps"],
    positiveExample: "To improve matches from your founder/operator profile",
    negativeExample: "What kind of role are you looking for?",
  },
  {
    mode: "negotiation" as const,
    anchors: ["stalled negotiation context", "counterparty hint", "community", "key takeaway"],
    positiveExample: "For the stalled match with an AI infra founder",
    negativeExample: "Which role is a better fit for your immediate needs?",
  },
];

describe("standalone prompt contract", () => {
  it.each(standaloneModeExpectations)("mode '$mode' requires self-contained generated prompt text", ({ mode, anchors, positiveExample, negativeExample }) => {
    const preset = getPreset(mode);

    expect(preset.systemPrompt).toContain("Standalone prompt rule");
    expect(preset.systemPrompt).toContain("Every generated `prompt` must be understandable outside the conversation where it was created");
    expect(preset.systemPrompt).toContain("question text itself");
    expect(preset.systemPrompt).toContain("Do not rely on `title`, UI labels, hidden metadata, or surrounding digest/chat text");
    expect(preset.systemPrompt).toContain(positiveExample);
    expect(preset.systemPrompt).toContain(negativeExample);
    for (const anchor of anchors) {
      expect(preset.systemPrompt).toContain(anchor);
    }
  });
});

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

  it("requires discovery prompts to include source context", () => {
    const preset = getPreset("discovery");
    expect(preset.systemPrompt).toContain("Standalone prompt rule");
    expect(preset.systemPrompt).toContain("original query");
    expect(preset.systemPrompt).toContain("discovery pattern");
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

  it("requires intent prompts to naturally include intent context", () => {
    const preset = getPreset("intent");
    expect(preset.systemPrompt).toContain("Standalone prompt rule");
    expect(preset.systemPrompt).toContain("source intent/topic");
    expect(preset.systemPrompt).toContain("What kind of collaboration are you looking for?");
    expect(preset.systemPrompt).toContain("decentralized identity protocol-design search");
  });
});

describe("profile preset", () => {
  it("returns the profile preset with systemPrompt and buildPrompt", () => {
    const preset = getPreset("profile");
    expect(preset).toBeDefined();
    expect(typeof preset.systemPrompt).toBe("string");
    expect(preset.systemPrompt.length).toBeGreaterThan(0);
    expect(typeof preset.buildPrompt).toBe("function");
  });

  it("profile buildPrompt produces a string containing the gaps", () => {
    const preset = getPreset("profile");
    const result = preset.buildPrompt({
      userProfile: { name: "Bob", bio: "Engineer" },
      gaps: ["location", "current work"],
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("location");
    expect(result).toContain("current work");
    expect(result).toContain("Bob");
  });

  it("profile buildPrompt includes existing premises when provided", () => {
    const preset = getPreset("profile");
    const result = preset.buildPrompt({
      userProfile: { name: "Bob", bio: "Engineer" },
      gaps: ["goals"],
      existingPremises: ["I live in Berlin", "I am a CTO at Acme Corp"],
    });
    expect(result).toContain("## Existing premises");
    expect(result).toContain("1. I live in Berlin");
    expect(result).toContain("2. I am a CTO at Acme Corp");
  });

  it("profile buildPrompt shows (none) when existingPremises is empty", () => {
    const preset = getPreset("profile");
    const result = preset.buildPrompt({
      userProfile: { name: "Bob" },
      gaps: ["location"],
      existingPremises: [],
    });
    expect(result).toContain("## Existing premises");
    expect(result).toContain("(none)");
  });

  it("profile buildPrompt shows (none) when existingPremises is absent", () => {
    const preset = getPreset("profile");
    const result = preset.buildPrompt({
      userProfile: { name: "Bob" },
      gaps: ["location"],
    });
    expect(result).toContain("## Existing premises");
    expect(result).toContain("(none)");
  });

  it("profile system prompt mentions premises", () => {
    const preset = getPreset("profile");
    expect(preset.systemPrompt).toContain("premises");
  });

  it("requires profile prompts to naturally include profile context", () => {
    const preset = getPreset("profile");
    expect(preset.systemPrompt).toContain("Standalone prompt rule");
    expect(preset.systemPrompt).toContain("profile signal or gap");
    expect(preset.systemPrompt).toContain("To improve matches from your founder/operator profile");
  });
});

describe("negotiation preset", () => {
  it("returns the negotiation preset with systemPrompt and buildPrompt", () => {
    const preset = getPreset("negotiation");
    expect(preset).toBeDefined();
    expect(typeof preset.systemPrompt).toBe("string");
    expect(preset.systemPrompt.length).toBeGreaterThan(0);
    expect(typeof preset.buildPrompt).toBe("function");
  });

  it("negotiation buildPrompt produces a string containing the stall reason", () => {
    const preset = getPreset("negotiation");
    const result = preset.buildPrompt({
      negotiationId: "neg-1",
      counterpartyHint: "AI infra founder, Berlin",
      indexContext: "AI founders community",
      outcomeReason: "turn_cap",
      keyTake: "Both interested but scope unclear",
      userProfile: { name: "Alice" },
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("turn_cap");
    expect(result).toContain("AI infra founder");
    expect(result).toContain("Alice");
  });

  it("requires negotiation prompts to naturally include stall context", () => {
    const preset = getPreset("negotiation");
    expect(preset.systemPrompt).toContain("Standalone prompt rule");
    expect(preset.systemPrompt).toContain("stalled negotiation context");
    expect(preset.systemPrompt).toContain("For the stalled match with an AI infra founder");
  });
});
