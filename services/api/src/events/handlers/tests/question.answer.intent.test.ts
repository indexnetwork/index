import { describe, it, expect, mock } from "bun:test";
import { enqueueIntentRefinementFactory, type IntentRefinementDeps } from "../question.answer.intent";

function makeDeps(overrides?: Partial<IntentRefinementDeps>): IntentRefinementDeps {
  return {
    getIntent: mock(async () => ({
      id: "int-1",
      userId: "u-1",
      description: "Looking for a React developer",
      status: "active",
    })),
    getQuestionPrompt: mock(async () => "What kind of developer are you looking for?"),
    refineDescription: mock(async () =>
      "Looking for a senior React developer with a frontend focus who knows TypeScript well",
    ),
    updateIntentDescription: mock(async () => {}),
    enqueueHydeRegeneration: mock(async () => {}),
    ...overrides,
  };
}

describe("enqueueIntentRefinementFactory", () => {
  it("rewrites the intent description via the LLM refiner and re-enqueues", async () => {
    const deps = makeDeps();
    const fn = enqueueIntentRefinementFactory(deps);

    await fn({
      userId: "u-1",
      intentId: "int-1",
      questionId: "q-1",
      selectedOptions: ["Frontend focus", "Senior level"],
      freeText: "Must know TypeScript well",
    });

    // The refiner receives full context: current description, question, answer.
    expect(deps.refineDescription).toHaveBeenCalledTimes(1);
    const refineCall = (deps.refineDescription as ReturnType<typeof mock>).mock.calls[0][0];
    expect(refineCall.currentDescription).toBe("Looking for a React developer");
    expect(refineCall.question).toBe("What kind of developer are you looking for?");
    expect(refineCall.selectedOptions).toEqual(["Frontend focus", "Senior level"]);
    expect(refineCall.freeText).toBe("Must know TypeScript well");

    expect(deps.updateIntentDescription).toHaveBeenCalledTimes(1);
    const updateCall = (deps.updateIntentDescription as ReturnType<typeof mock>).mock.calls[0];
    expect(updateCall[0]).toBe("int-1"); // intentId
    // The stored description is the LLM rewrite — no mechanical markers.
    const newDesc: string = updateCall[1];
    expect(newDesc).toBe(
      "Looking for a senior React developer with a frontend focus who knows TypeScript well",
    );
    expect(newDesc).not.toContain("[Refined:");

    expect(deps.enqueueHydeRegeneration).toHaveBeenCalledTimes(1);
    const hydeCall = (deps.enqueueHydeRegeneration as ReturnType<typeof mock>).mock.calls[0][0];
    expect(hydeCall.intentId).toBe("int-1");
    expect(hydeCall.userId).toBe("u-1");
  });

  it("falls back to a marker-free plain append when the LLM refiner fails", async () => {
    const deps = makeDeps({ refineDescription: mock(async () => null) });
    const fn = enqueueIntentRefinementFactory(deps);

    await fn({
      userId: "u-1",
      intentId: "int-1",
      questionId: "q-1",
      selectedOptions: ["Frontend focus", "Senior level"],
      freeText: "Must know TypeScript well",
    });

    expect(deps.updateIntentDescription).toHaveBeenCalledTimes(1);
    const newDesc: string = (deps.updateIntentDescription as ReturnType<typeof mock>).mock.calls[0][1];
    // Original preserved + answer content appended...
    expect(newDesc).toContain("Looking for a React developer");
    expect(newDesc).toContain("Frontend focus");
    expect(newDesc).toContain("Senior level");
    expect(newDesc).toContain("Must know TypeScript well");
    // ...but never with a mechanical marker.
    expect(newDesc).not.toContain("[Refined:");

    // The pipeline still re-embeds.
    expect(deps.enqueueHydeRegeneration).toHaveBeenCalledTimes(1);
  });

  it("passes question as undefined when the prompt is unavailable", async () => {
    const deps = makeDeps({ getQuestionPrompt: mock(async () => null) });
    const fn = enqueueIntentRefinementFactory(deps);

    await fn({
      userId: "u-1",
      intentId: "int-1",
      questionId: "q-404",
      selectedOptions: ["A"],
    });

    const refineCall = (deps.refineDescription as ReturnType<typeof mock>).mock.calls[0][0];
    expect(refineCall.question).toBeUndefined();
    expect(deps.updateIntentDescription).toHaveBeenCalledTimes(1);
  });

  it("skips if intent not found", async () => {
    const deps = makeDeps({ getIntent: mock(async () => null) });
    const fn = enqueueIntentRefinementFactory(deps);

    await fn({
      userId: "u-1",
      intentId: "int-404",
      questionId: "q-1",
      selectedOptions: ["A"],
    });

    expect(deps.refineDescription).not.toHaveBeenCalled();
    expect(deps.updateIntentDescription).not.toHaveBeenCalled();
    expect(deps.enqueueHydeRegeneration).not.toHaveBeenCalled();
  });

  it("skips if intent belongs to a different user", async () => {
    const deps = makeDeps({
      getIntent: mock(async () => ({
        id: "int-1",
        userId: "u-other",
        description: "Someone else's intent",
        status: "active",
      })),
    });
    const fn = enqueueIntentRefinementFactory(deps);

    await fn({
      userId: "u-1",
      intentId: "int-1",
      questionId: "q-1",
      selectedOptions: ["A"],
    });

    expect(deps.refineDescription).not.toHaveBeenCalled();
    expect(deps.updateIntentDescription).not.toHaveBeenCalled();
  });

  it("skips if intent is not active", async () => {
    const deps = makeDeps({
      getIntent: mock(async () => ({
        id: "int-1",
        userId: "u-1",
        description: "Archived intent",
        status: "archived",
      })),
    });
    const fn = enqueueIntentRefinementFactory(deps);

    await fn({
      userId: "u-1",
      intentId: "int-1",
      questionId: "q-1",
      selectedOptions: ["A"],
    });

    expect(deps.refineDescription).not.toHaveBeenCalled();
    expect(deps.updateIntentDescription).not.toHaveBeenCalled();
  });

  it("handles free-text-only answers (empty selectedOptions) in the fallback path", async () => {
    const deps = makeDeps({ refineDescription: mock(async () => null) });
    const fn = enqueueIntentRefinementFactory(deps);

    await fn({
      userId: "u-1",
      intentId: "int-1",
      questionId: "q-1",
      selectedOptions: [],
      freeText: "Must be available for in-person meetings",
    });

    const updateCall = (deps.updateIntentDescription as ReturnType<typeof mock>).mock.calls[0];
    const newDesc: string = updateCall[1];
    expect(newDesc).toContain("Must be available for in-person meetings");
    expect(newDesc).not.toContain("[Refined:");
    // No stray leading separator from the empty options list.
    expect(newDesc).not.toContain("\n\n. ");
  });

  it("skips refinement when answer has no content", async () => {
    const deps = makeDeps();
    const fn = enqueueIntentRefinementFactory(deps);

    await fn({
      userId: "u-1",
      intentId: "int-1",
      questionId: "q-1",
      selectedOptions: [],
      freeText: "   ",
    });

    expect(deps.refineDescription).not.toHaveBeenCalled();
    expect(deps.updateIntentDescription).not.toHaveBeenCalled();
    expect(deps.enqueueHydeRegeneration).not.toHaveBeenCalled();
  });
});
