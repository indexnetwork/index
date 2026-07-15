import { describe, it, expect } from "bun:test";
import { getPreset } from "../questioner.presets.js";
import { QuestionModeSchema, QuestionSchema } from "../../shared/schemas/question.schema.js";

const standaloneModeExpectations = [
  {
    mode: "discovery" as const,
    anchors: ["original query", "discovery pattern", "connection pattern", "concrete learned fact"],
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
    mode: "enrichment" as const,
    anchors: ["profile signal or gap", "current profile", "existing premises", "identified gaps"],
    positiveExample: "To improve matches from your founder/operator profile",
    negativeExample: "What kind of role are you looking for?",
  },
  {
    mode: "negotiation" as const,
    anchors: ["underlying goal or topic", "relevant community", "intent or profile"],
    positiveExample: "For your search for AI infrastructure collaborators in the AI founders community",
    negativeExample: "Which role is a better fit for your immediate needs?",
  },
  {
    mode: "negotiation_inflight" as const,
    anchors: ["disclosure subject", "counterparty hint"],
    positiveExample: "May I share your budget range with a Berlin-based AI-infrastructure founder",
    negativeExample: "Can I share your budget with them?",
  },
];

// Modes whose prompts must carry the shared referential-closure guardrail.
// (chat renders inline in the active conversation, so it is exempt from the
// standalone-prompt contract above but still carries referential closure.)
const ALL_MODES = ["discovery", "intent", "enrichment", "negotiation", "negotiation_inflight", "chat"] as const;

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

describe("QUD taxonomy contract", () => {
  it.each(ALL_MODES)("mode '%s' receives the required structured-output metadata contract", (mode) => {
    const prompt = getPreset(mode).systemPrompt;
    expect(prompt).toContain("QUD underspecification taxonomy");
    expect(prompt).toContain("missing_constituent");
    expect(prompt).toContain("missing_constraint");
    expect(prompt).toContain("open_alternative_set");
    expect(prompt).toContain("Strategy and underspecification type are orthogonal");
    expect(prompt).toContain("Use null");
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
      userContext: "Alice is an AI researcher.",
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
      userContext: "Alice is an AI researcher.",
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
    const preset = getPreset("enrichment");
    expect(preset).toBeDefined();
    expect(typeof preset.systemPrompt).toBe("string");
    expect(preset.systemPrompt.length).toBeGreaterThan(0);
    expect(typeof preset.buildPrompt).toBe("function");
  });

  it("profile buildPrompt produces a string containing the gaps", () => {
    const preset = getPreset("enrichment");
    const result = preset.buildPrompt({
      userContext: "Bob is an engineer.",
      gaps: ["location", "current work"],
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("location");
    expect(result).toContain("current work");
    expect(result).toContain("Bob");
  });

  it("profile buildPrompt includes existing premises when provided", () => {
    const preset = getPreset("enrichment");
    const result = preset.buildPrompt({
      userContext: "Bob is an engineer.",
      gaps: ["goals"],
      existingPremises: ["I live in Berlin", "I am a CTO at Acme Corp"],
    });
    expect(result).toContain("## Existing premises");
    expect(result).toContain("1. I live in Berlin");
    expect(result).toContain("2. I am a CTO at Acme Corp");
  });

  it("profile buildPrompt shows (none) when existingPremises is empty", () => {
    const preset = getPreset("enrichment");
    const result = preset.buildPrompt({
      userContext: "Bob is an engineer.",
      gaps: ["location"],
      existingPremises: [],
    });
    expect(result).toContain("## Existing premises");
    expect(result).toContain("(none)");
  });

  it("profile buildPrompt shows (none) when existingPremises is absent", () => {
    const preset = getPreset("enrichment");
    const result = preset.buildPrompt({
      userContext: "Bob is an engineer.",
      gaps: ["location"],
    });
    expect(result).toContain("## Existing premises");
    expect(result).toContain("(none)");
  });

  it("profile system prompt mentions premises", () => {
    const preset = getPreset("enrichment");
    expect(preset.systemPrompt).toContain("premises");
  });

  it("requires profile prompts to naturally include profile context", () => {
    const preset = getPreset("enrichment");
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
      userContext: "Alice is a builder.",
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("turn_cap");
    expect(result).toContain("AI infra founder");
    expect(result).toContain("Alice");
  });

  it("requires negotiation prompts to anchor on the user's goal, not the match mechanics", () => {
    const preset = getPreset("negotiation");
    expect(preset.systemPrompt).toContain("Standalone prompt rule");
    expect(preset.systemPrompt).toContain("underlying goal or topic");
    expect(preset.systemPrompt).toContain("For your search for AI infrastructure collaborators in the AI founders community");
    // Must NOT instruct the model to restate the stalled-negotiation mechanics.
    expect(preset.systemPrompt).not.toContain("stalled negotiation context");
  });
});

describe("negotiation_inflight preset", () => {
  const baseContext = {
    negotiationId: "neg-42",
    counterpartyHint: "a fintech CTO exploring agent tooling in Berlin",
    disclosureSubject: "permission to share the client's budget range",
    indexContext: "AI founders community",
    userContext: "Alice is a protocol engineer.",
  };

  it("is a registered QuestionMode and returns a preset with systemPrompt and buildPrompt", () => {
    expect(QuestionModeSchema.options).toContain("negotiation_inflight");
    const preset = getPreset("negotiation_inflight");
    expect(typeof preset.systemPrompt).toBe("string");
    expect(preset.systemPrompt.length).toBeGreaterThan(0);
    expect(typeof preset.buildPrompt).toBe("function");
  });

  it("buildPrompt contains the counterparty hint, disclosure subject, and community", () => {
    const preset = getPreset("negotiation_inflight");
    const result = preset.buildPrompt(baseContext);
    expect(result).toContain("a fintech CTO exploring agent tooling in Berlin");
    expect(result).toContain("permission to share the client's budget range");
    expect(result).toContain("AI founders community");
    expect(result).toContain("Alice is a protocol engineer.");
  });

  it("buildPrompt passes the negotiator's draft question through for refinement", () => {
    const preset = getPreset("negotiation_inflight");
    const result = preset.buildPrompt({
      ...baseContext,
      draftQuestion: "Is it OK if I tell them your budget is around €50k?",
    });
    expect(result).toContain("## Draft question proposed by the negotiator");
    expect(result).toContain("Is it OK if I tell them your budget is around €50k?");
    // Refinement instruction, not replacement
    expect(result).toContain("Honor the draft when provided");
  });

  it("buildPrompt falls back to the disclosure subject when no draft is provided", () => {
    const preset = getPreset("negotiation_inflight");
    const result = preset.buildPrompt(baseContext);
    expect(result).toContain("(none — derive the question from the disclosure subject)");
  });

  it("buildPrompt shows (no profile data) when userContext is absent", () => {
    const preset = getPreset("negotiation_inflight");
    const { userContext: _omit, ...noProfile } = baseContext;
    const result = preset.buildPrompt(noProfile);
    expect(result).toContain("(no profile data)");
  });

  it("system prompt biases toward disclosure gating with clear yes/no options", () => {
    const preset = getPreset("negotiation_inflight");
    expect(preset.systemPrompt).toContain("Bias toward disclosure gating");
    expect(preset.systemPrompt).toContain("yes/no");
    expect(preset.systemPrompt).toContain("free-text fallback");
    expect(preset.systemPrompt).toContain("the first option authorizes sharing, the second declines");
    // Honors the negotiator's draft like chat honors the orchestrator's
    expect(preset.systemPrompt).toContain("Honor the negotiator's intent");
    expect(preset.systemPrompt).toContain("Do not invent questions about topics the negotiator did not raise");
    // Identity protection
    expect(preset.systemPrompt).toContain("Don't reveal the counterparty's identity");
  });

  it("a disclosure-gate shaped output validates against the question schema", () => {
    // The shape the preset's rules ask the model to produce must be
    // structurally valid per QuestionSchema (same schema the agent parses with).
    const disclosureQuestion = {
      title: "Disclosure",
      prompt: "May I share your budget range with a Berlin-based fintech CTO you're being matched with?",
      options: [
        { label: "Yes, share the range (Recommended)", description: "Your negotiator discloses the budget range and continues negotiating with it on the table." },
        { label: "No, keep it private", description: "Your negotiator continues without revealing any budget figure." },
      ],
      multiSelect: false,
    };
    const parsed = QuestionSchema.safeParse(disclosureQuestion);
    expect(parsed.success).toBe(true);
  });
});

describe("chat preset", () => {
  it("returns the chat preset with systemPrompt and buildPrompt", () => {
    const preset = getPreset("chat");
    expect(typeof preset.systemPrompt).toBe("string");
    expect(preset.systemPrompt.length).toBeGreaterThan(0);
    expect(typeof preset.buildPrompt).toBe("function");
  });

  it("chat buildPrompt includes purpose, drafts, excerpt, and user context", () => {
    const preset = getPreset("chat");
    const result = preset.buildPrompt({
      purpose: "Need the user's timing before running discovery.",
      draftQuestions: [
        { prompt: "When do you want to start?", options: ["Now", "Later"], multiSelect: false },
      ],
      conversationExcerpt: "User: I want to find collaborators.",
      userContext: "Alice is a protocol engineer.",
    });
    expect(typeof result).toBe("string");
    expect(result).toContain("Need the user's timing");
    expect(result).toContain("When do you want to start?");
    expect(result).toContain("[options: Now | Later]");
    expect(result).toContain("I want to find collaborators");
    expect(result).toContain("Alice is a protocol engineer.");
  });

  it("chat buildPrompt handles missing drafts and excerpt", () => {
    const preset = getPreset("chat");
    const result = preset.buildPrompt({
      purpose: "Need the user's budget range.",
    });
    expect(result).toContain("(none — derive questions from the purpose)");
    expect(result).toContain("(not available)");
    expect(result).toContain("(no profile data)");
  });

  it("chat system prompt honors the orchestrator's drafts and bans padding", () => {
    const preset = getPreset("chat");
    expect(preset.systemPrompt).toContain("Honor the orchestrator's intent");
    expect(preset.systemPrompt).toContain("Do not invent questions about topics the orchestrator did not raise");
    expect(preset.systemPrompt).toContain("Never pad");
  });
});

describe("referential closure contract", () => {
  it.each(ALL_MODES)("mode '%s' forbids dangling references and process narration", (mode) => {
    const preset = getPreset(mode);
    expect(preset.systemPrompt).toContain("Referential closure");
    expect(preset.systemPrompt).toContain("No process narration");
    // The canonical defect examples must be named as anti-patterns.
    expect(preset.systemPrompt).toContain("these builders");
    expect(preset.systemPrompt).toContain("the counterparty");
  });
});
