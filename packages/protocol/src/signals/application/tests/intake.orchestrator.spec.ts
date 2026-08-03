import { describe, expect, it } from "bun:test";

import { answerLabel, FALLBACK_BRING_QUESTION, FALLBACK_WHO_QUESTION, SignalIntakeOrchestrator } from "../intake.orchestrator.js";

function stub<T>(value: T, capture?: { prompt?: string }) {
  return {
    invoke: async (messages: Array<{ content: unknown }>) => {
      if (capture) capture.prompt = String(messages[messages.length - 1]?.content ?? "");
      return value;
    },
  } as never;
}

const question = {
  title: "Question 2",
  prompt: "What would you bring to that connection?",
  options: [
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
  const plan = {
    questions: [question, { ...question, prompt: "Where should we look?" }],
    plannedFollowUpCount: 2,
  };

  it("returns the planned questions and count, grounded in brief and rounds", async () => {
    const capture: { prompt?: string } = {};
    const orchestrator = new SignalIntakeOrchestrator({ planner: stub(plan, capture) });

    const result = await orchestrator.generateFollowUps({
      brief: "Ada builds developer tools.",
      rounds: [{ prompt: "Who do you want to meet?", answer: { selectedOptions: ["A design partner"] } }],
      maxFollowUps: 3,
    });

    expect(result.questions).toHaveLength(2);
    expect(result.plannedFollowUpCount).toBe(2);
    expect(capture.prompt).toContain("Ada builds developer tools.");
    expect(capture.prompt).toContain("A design partner");
  });

  it("truncates model output to maxFollowUps", async () => {
    const orchestrator = new SignalIntakeOrchestrator({ planner: stub(plan) });

    const result = await orchestrator.generateFollowUps({
      brief: "b",
      rounds: [{ prompt: "p", answer: { selectedOptions: ["x"] } }],
      maxFollowUps: 1,
    });

    expect(result.questions).toHaveLength(1);
    expect(result.plannedFollowUpCount).toBe(2);
  });

  it("echoes a locked plannedFollowUpCount instead of re-planning", async () => {
    const orchestrator = new SignalIntakeOrchestrator({ planner: stub(plan) });

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
