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

describe("SignalIntakeOrchestrator.nextQuestion", () => {
  it("grounds round 2 in the brief and the round-1 answer", async () => {
    const capture: { prompt?: string } = {};
    const orchestrator = new SignalIntakeOrchestrator({ question: stub(question, capture) });

    const result = await orchestrator.nextQuestion({
      brief: "Ada builds developer tools.",
      whoAnswer: { selectedOptions: ["A design partner"] },
    });

    expect(result.prompt).toBe("What would you bring to that connection?");
    expect(capture.prompt).toContain("Ada builds developer tools.");
    expect(capture.prompt).toContain("A design partner");
  });

  it("falls back to the static question when the model fails", async () => {
    const orchestrator = new SignalIntakeOrchestrator({
      question: { invoke: async () => { throw new Error("model down"); } } as never,
    });

    const result = await orchestrator.nextQuestion({
      brief: "b",
      whoAnswer: { selectedOptions: ["x"] },
    });

    expect(result).toEqual(FALLBACK_BRING_QUESTION);
  });
});

describe("SignalIntakeOrchestrator.synthesize", () => {
  const synthesis = {
    description: "Looking for a design partner to test developer tooling.",
    lookingFor: "A design partner",
    youBring: "Engineering depth",
  };

  it("includes both answers in the synthesis prompt", async () => {
    const capture: { prompt?: string } = {};
    const orchestrator = new SignalIntakeOrchestrator({ synthesis: stub(synthesis, capture) });

    const result = await orchestrator.synthesize({
      brief: "Ada builds developer tools.",
      whoAnswer: { selectedOptions: ["A design partner"] },
      bringAnswer: { selectedOptions: ["Engineering depth"] },
    });

    expect(result.description).toBe(synthesis.description);
    expect(capture.prompt).toContain("A design partner");
    expect(capture.prompt).toContain("Engineering depth");
  });

  it("includes the where constraint only when provided", async () => {
    const withWhere: { prompt?: string } = {};
    const withoutWhere: { prompt?: string } = {};

    await new SignalIntakeOrchestrator({ synthesis: stub(synthesis, withWhere) }).synthesize({
      brief: "b",
      whoAnswer: { selectedOptions: ["x"] },
      bringAnswer: { selectedOptions: ["y"] },
      whereText: "Berlin only",
    });
    await new SignalIntakeOrchestrator({ synthesis: stub(synthesis, withoutWhere) }).synthesize({
      brief: "b",
      whoAnswer: { selectedOptions: ["x"] },
      bringAnswer: { selectedOptions: ["y"] },
    });

    expect(withWhere.prompt).toContain("Berlin only");
    expect(withoutWhere.prompt).not.toContain("Where constraint");
  });

  it("renders revision feedback in its own slot, never as a where constraint", async () => {
    const capture: { prompt?: string } = {};

    await new SignalIntakeOrchestrator({ synthesis: stub(synthesis, capture) }).synthesize({
      brief: "b",
      whoAnswer: { selectedOptions: ["x"] },
      bringAnswer: { selectedOptions: ["y"] },
      feedback: "make it about hardware, not software",
    });

    expect(capture.prompt).toContain("Revision feedback on the previous draft: make it about hardware, not software");
    // The regression this pins: feedback used to be passed as `whereText`, so a
    // content correction was presented to the model as a location constraint.
    expect(capture.prompt).not.toContain("Where constraint");
  });

  it("keeps a where constraint and revision feedback in separate slots", async () => {
    const capture: { prompt?: string } = {};

    await new SignalIntakeOrchestrator({ synthesis: stub(synthesis, capture) }).synthesize({
      brief: "b",
      whoAnswer: { selectedOptions: ["x"] },
      bringAnswer: { selectedOptions: ["y"] },
      whereText: "Berlin only",
      feedback: "more senior",
    });

    expect(capture.prompt).toContain("Where constraint: Berlin only");
    expect(capture.prompt).toContain("Revision feedback on the previous draft: more senior");
  });

  it("propagates synthesis failures so the caller can degrade", async () => {
    const orchestrator = new SignalIntakeOrchestrator({
      synthesis: { invoke: async () => { throw new Error("model down"); } } as never,
    });

    await expect(orchestrator.synthesize({
      brief: "b",
      whoAnswer: { selectedOptions: ["x"] },
      bringAnswer: { selectedOptions: ["y"] },
    })).rejects.toThrow("model down");
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
