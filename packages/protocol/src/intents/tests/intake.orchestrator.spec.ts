import { describe, expect, it } from "bun:test";

import { answerLabel, FALLBACK_BRING_QUESTION, FALLBACK_WHO_QUESTION, SignalIntakeOrchestrator } from "../application/intake.orchestrator.js";

interface Capture {
  prompt?: string;
  messages?: string[];
}

function stub<T>(value: T, capture?: Capture) {
  return {
    invoke: async (messages: Array<{ content: unknown }>) => {
      if (capture) {
        capture.prompt = String(messages[messages.length - 1]?.content ?? "");
        capture.messages = messages.map((message) => String(message.content ?? ""));
      }
      return value;
    },
  } as never;
}

const NO_BRIDGES = { bridges: [] };

function plannerModels<T>(plan: T, capture?: Capture) {
  return {
    planner: stub(plan, capture),
    profileBridge: stub(NO_BRIDGES),
  };
}

const question = {
  missingAxis: "exchange" as const,
  title: "Question 2",
  prompt: "What would you bring to that connection?",
  answerGroundedOptions: [
    { label: "Distribution", description: "You have an audience" },
    { label: "Engineering depth", description: "You can build it" },
  ],
  multiSelect: false,
};

describe("answerLabel", () => {
  it("joins selected options and free text", () => {
    expect(answerLabel({ selectedOptions: ["A", "B"], freeText: "and C" })).toBe("A, B, and C");
  });

  it("ignores empty free text", () => {
    expect(answerLabel({ selectedOptions: ["A"], freeText: "   " })).toBe("A");
  });
});

describe("SignalIntakeOrchestrator.generateFollowUps", () => {
  it("assembles answer-grounded options before one optional profile bridge", async () => {
    const orchestrator = new SignalIntakeOrchestrator({
      planner: stub({
        questions: [{
          missingAxis: "purpose",
          title: "Purpose",
          prompt: "What would make meeting scuba divers valuable to you?",
          answerGroundedOptions: [
            { label: "Find dive buddies", description: "Meet people to dive with" },
            { label: "Learn from experts", description: "Meet experienced divers" },
            { label: "Marine conservation", description: "Work on ocean stewardship" },
          ],
          multiSelect: false,
        }],
        plannedFollowUpCount: 1,
      }),
      profileBridge: stub({
        bridges: [{
          questionIndex: 0,
          profileBridgeOption: {
            label: "Underwater technology",
            description: "Connect diving with your technology background",
          },
        }],
      }),
    });

    const result = await orchestrator.generateFollowUps({
      brief: "The user builds AI products.",
      rounds: [{ prompt: "Who do you want to meet?", answer: { selectedOptions: [], freeText: "scuba divers" } }],
      maxFollowUps: 1,
    });

    expect(result.questions[0]?.options.map((option) => option.label)).toEqual([
      "Find dive buddies",
      "Learn from experts",
      "Marine conservation",
      "Underwater technology",
    ]);
  });

  const plan = {
    questions: [question, { ...question, prompt: "Where should we look?" }],
    plannedFollowUpCount: 2,
  };

  it("keeps the profile out of core generation and sends it only to bridge generation", async () => {
    const plannerCapture: Capture = {};
    const bridgeCapture: Capture = {};
    const orchestrator = new SignalIntakeOrchestrator({
      planner: stub(plan, plannerCapture),
      profileBridge: stub({ bridges: [] }, bridgeCapture),
    });

    const result = await orchestrator.generateFollowUps({
      brief: "Ada builds developer tools.",
      rounds: [{ prompt: "Who do you want to meet?", answer: { selectedOptions: ["A design partner"] } }],
      maxFollowUps: 3,
    });

    expect(result.questions).toHaveLength(2);
    expect(result.plannedFollowUpCount).toBe(2);
    expect(plannerCapture.prompt).toContain("A design partner");
    expect(plannerCapture.prompt).not.toContain("Ada builds developer tools.");
    expect(plannerCapture.messages?.[0]).toContain("receive ONLY the answered intake rounds");
    expect(plannerCapture.messages?.[0]).toContain("Generic labels");
    expect(plannerCapture.messages?.[0]).toContain("Learn diving techniques");
    expect(bridgeCapture.prompt).toContain("Ada builds developer tools.");
    expect(bridgeCapture.prompt).toContain("A design partner");
    expect(bridgeCapture.prompt).toContain("IMMUTABLE CORE QUESTIONS");
    expect(bridgeCapture.messages?.[0]).toContain("question, missing axis, and answer-grounded options are immutable");
  });

  it("deduplicates options without letting the profile bridge displace two answer-grounded choices", async () => {
    const orchestrator = new SignalIntakeOrchestrator({
      planner: stub({
        questions: [{
          missingAxis: "desired_attributes",
          title: "Divers",
          prompt: "Which scuba divers would be most useful to meet?",
          answerGroundedOptions: [
            { label: "Dive buddies", description: "People to dive with" },
            { label: " dive buddies ", description: "Duplicate after trimming" },
            { label: "Experienced instructors", description: "People to learn from" },
          ],
          multiSelect: false,
        }],
        plannedFollowUpCount: 1,
      }),
      profileBridge: stub({
        bridges: [{
          questionIndex: 0,
          profileBridgeOption: {
            label: "Underwater technologists",
            description: "A natural bridge to the user's background",
          },
        }],
      }),
    });

    const result = await orchestrator.generateFollowUps({
      brief: "The user builds technology products.",
      rounds: [{ prompt: "Who?", answer: { selectedOptions: ["Scuba divers"] } }],
      maxFollowUps: 1,
    });

    expect(result.questions[0]?.options.map((option) => option.label)).toEqual([
      "Dive buddies",
      "Experienced instructors",
      "Underwater technologists",
    ]);
  });

  it("falls back when deduplication leaves fewer than two answer-grounded choices", async () => {
    const orchestrator = new SignalIntakeOrchestrator({
      planner: stub({
        questions: [{
          missingAxis: "purpose",
          title: "Purpose",
          prompt: "What do you want from meeting scuba divers?",
          answerGroundedOptions: [
            { label: "Dive buddies", description: "People to dive with" },
            { label: " dive buddies ", description: "The same choice" },
          ],
          multiSelect: false,
        }],
        plannedFollowUpCount: 1,
      }),
      profileBridge: stub({
        bridges: [{
          questionIndex: 0,
          profileBridgeOption: {
            label: "Underwater technology",
            description: "A profile-derived bridge",
          },
        }],
      }),
    });

    const result = await orchestrator.generateFollowUps({
      brief: "The user builds technology products.",
      rounds: [{ prompt: "Who?", answer: { selectedOptions: ["Scuba divers"] } }],
      maxFollowUps: 1,
    });

    expect(result).toEqual({
      questions: [FALLBACK_BRING_QUESTION],
      plannedFollowUpCount: 1,
    });
  });

  it("keeps valid core questions when optional bridge generation fails", async () => {
    const orchestrator = new SignalIntakeOrchestrator({
      planner: stub({ questions: [question], plannedFollowUpCount: 1 }),
      profileBridge: { invoke: async () => { throw new Error("bridge model down"); } } as never,
    });

    const result = await orchestrator.generateFollowUps({
      brief: "Ada builds developer tools.",
      rounds: [{ prompt: "Who?", answer: { selectedOptions: ["A design partner"] } }],
      maxFollowUps: 1,
    });

    expect(result.questions[0]?.options.map((option) => option.label)).toEqual([
      "Distribution",
      "Engineering depth",
    ]);
  });

  it("truncates model output to maxFollowUps", async () => {
    const orchestrator = new SignalIntakeOrchestrator(plannerModels(plan));

    const result = await orchestrator.generateFollowUps({
      brief: "b",
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
      maxFollowUps: 1,
    });

    expect(result.questions).toHaveLength(1);
    expect(result.plannedFollowUpCount).toBe(2);
  });

  it("echoes a locked plannedFollowUpCount instead of re-planning", async () => {
    const orchestrator = new SignalIntakeOrchestrator(plannerModels(plan));

    const result = await orchestrator.generateFollowUps({
      brief: "b",
      rounds: [
        { prompt: "p1", answer: { selectedOptions: ["x"] } },
        { prompt: "p2", answer: { selectedOptions: ["y"] } },
      ],
      maxFollowUps: 1,
      plannedFollowUpCount: 3,
    });

    expect(result.plannedFollowUpCount).toBe(3);
  });

  it("falls back to the static question with count 1 when the model fails", async () => {
    const orchestrator = new SignalIntakeOrchestrator({
      planner: { invoke: async () => { throw new Error("model down"); } } as never,
    });

    const result = await orchestrator.generateFollowUps({
      brief: "b",
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
      maxFollowUps: 2,
    });

    expect(result).toEqual({ questions: [FALLBACK_BRING_QUESTION], plannedFollowUpCount: 1 });
  });

  it("serves the static fallback when the planner returns zero follow-ups with budget remaining", async () => {
    const orchestrator = new SignalIntakeOrchestrator({
      planner: stub({ questions: [], plannedFollowUpCount: 0 }),
    });

    const result = await orchestrator.generateFollowUps({
      brief: "b",
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
      maxFollowUps: 2,
    });

    expect(result).toEqual({ questions: [FALLBACK_BRING_QUESTION], plannedFollowUpCount: 1 });
  });
});

describe("SignalIntakeOrchestrator.synthesize", () => {
  const synthesis = {
    description: "Looking for a design partner to test developer tooling.",
    lookingFor: "A design partner",
    youBring: "Engineering depth",
  };

  it("renders every round into the synthesis prompt", async () => {
    const capture: { prompt?: string } = {};
    const orchestrator = new SignalIntakeOrchestrator({ synthesis: stub(synthesis, capture) });

    const result = await orchestrator.synthesize({
      brief: "Ada builds developer tools.",
      rounds: [
        { prompt: "Who do you want to meet?", answer: { selectedOptions: ["A design partner"] } },
        { prompt: "What do you bring?", answer: { selectedOptions: ["Engineering depth"] } },
        { prompt: "When?", answer: { selectedOptions: [], freeText: "This quarter" } },
      ],
    });

    expect(result.description).toBe(synthesis.description);
    expect(capture.prompt).toContain("Q: Who do you want to meet?\nA: A design partner");
    expect(capture.prompt).toContain("Q: What do you bring?\nA: Engineering depth");
    expect(capture.prompt).toContain("Q: When?\nA: This quarter");
  });

  it("appends where and feedback lines when present", async () => {
    const capture: { prompt?: string } = {};
    const orchestrator = new SignalIntakeOrchestrator({ synthesis: stub(synthesis, capture) });

    await orchestrator.synthesize({
      brief: "b",
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
      whereText: "Berlin",
      feedback: "shorter please",
    });

    expect(capture.prompt).toContain("Where constraint: Berlin");
    expect(capture.prompt).toContain("Revision feedback on the previous draft: shorter please");
  });

  it("propagates synthesis model failure so the caller can mark the run failed", async () => {
    const orchestrator = new SignalIntakeOrchestrator({
      synthesis: { invoke: async () => { throw new Error("model down"); } } as never,
    });

    await expect(orchestrator.synthesize({
      brief: "b",
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
    })).rejects.toThrow("model down");
  });

  it("renders revision feedback in its own slot, never as a where constraint", async () => {
    const capture: { prompt?: string } = {};
    const orchestrator = new SignalIntakeOrchestrator({ synthesis: stub(synthesis, capture) });

    await orchestrator.synthesize({
      brief: "b",
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
      feedback: "shorter please",
    });

    expect(capture.prompt).toContain("Revision feedback on the previous draft: shorter please");
    expect(capture.prompt).not.toContain("Where constraint");
  });
});

describe("static fallbacks", () => {
  it("are renderable questions", () => {
    for (const q of [FALLBACK_WHO_QUESTION, FALLBACK_BRING_QUESTION]) {
      expect(q.prompt.length).toBeGreaterThan(0);
      expect(q.options.length).toBeGreaterThanOrEqual(2);
    }
  });
});
