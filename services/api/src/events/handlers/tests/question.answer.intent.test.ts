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
    getUserProfile: mock(async () => '{"identity":"Founder"}'),
    runIntentUpdate: mock(async () => ({ applied: true })),
    ...overrides,
  };
}

describe("enqueueIntentRefinementFactory", () => {
  it("runs the intent graph in update mode with composed answer context", async () => {
    const deps = makeDeps();
    const fn = enqueueIntentRefinementFactory(deps);

    await fn({
      userId: "u-1",
      intentId: "int-1",
      questionId: "q-1",
      selectedOptions: ["Frontend focus", "Senior level"],
      freeText: "Must know TypeScript well",
    });

    expect(deps.runIntentUpdate).toHaveBeenCalledTimes(1);
    const call = (deps.runIntentUpdate as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.userId).toBe("u-1");
    expect(call.userProfile).toBe('{"identity":"Founder"}');
    expect(call.targetIntentIds).toEqual(["int-1"]);
    // Composed content carries the current description, question, and answer.
    expect(call.inputContent).toContain("Looking for a React developer");
    expect(call.inputContent).toContain("What kind of developer are you looking for?");
    expect(call.inputContent).toContain("Frontend focus; Senior level");
    expect(call.inputContent).toContain("Must know TypeScript well");
    // Never the old mechanical marker.
    expect(call.inputContent).not.toContain("[Refined:");
  });

  it("composes content without question framing when the prompt is unavailable", async () => {
    const deps = makeDeps({ getQuestionPrompt: mock(async () => null) });
    const fn = enqueueIntentRefinementFactory(deps);

    await fn({
      userId: "u-1",
      intentId: "int-1",
      questionId: "q-404",
      selectedOptions: ["Remote only"],
    });

    const call = (deps.runIntentUpdate as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.inputContent).toContain("Remote only");
    expect(call.inputContent).not.toContain("When asked");
  });

  it("does not throw when the graph does not apply the update (vague answer)", async () => {
    const deps = makeDeps({ runIntentUpdate: mock(async () => ({ applied: false })) });
    const fn = enqueueIntentRefinementFactory(deps);

    await fn({
      userId: "u-1",
      intentId: "int-1",
      questionId: "q-1",
      selectedOptions: ["A"],
    });

    expect(deps.runIntentUpdate).toHaveBeenCalledTimes(1);
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

    expect(deps.runIntentUpdate).not.toHaveBeenCalled();
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

    expect(deps.runIntentUpdate).not.toHaveBeenCalled();
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

    expect(deps.runIntentUpdate).not.toHaveBeenCalled();
  });

  it("handles free-text-only answers (empty selectedOptions)", async () => {
    const deps = makeDeps();
    const fn = enqueueIntentRefinementFactory(deps);

    await fn({
      userId: "u-1",
      intentId: "int-1",
      questionId: "q-1",
      selectedOptions: [],
      freeText: "Must be available for in-person meetings",
    });

    const call = (deps.runIntentUpdate as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.inputContent).toContain("Must be available for in-person meetings");
    // No stray separator from the empty options list.
    expect(call.inputContent).not.toContain(": . ");
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

    expect(deps.getQuestionPrompt).not.toHaveBeenCalled();
    expect(deps.runIntentUpdate).not.toHaveBeenCalled();
  });
});
