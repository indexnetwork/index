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
    updateIntentDescription: mock(async () => {}),
    enqueueHydeRegeneration: mock(async () => {}),
    ...overrides,
  };
}

describe("enqueueIntentRefinementFactory", () => {
  it("appends answer context to intent description and re-enqueues", async () => {
    const deps = makeDeps();
    const fn = enqueueIntentRefinementFactory(deps);

    await fn({
      userId: "u-1",
      intentId: "int-1",
      questionId: "q-1",
      selectedOptions: ["Frontend focus", "Senior level"],
      freeText: "Must know TypeScript well",
    });

    expect(deps.updateIntentDescription).toHaveBeenCalledTimes(1);
    const updateCall = (deps.updateIntentDescription as ReturnType<typeof mock>).mock.calls[0];
    expect(updateCall[0]).toBe("int-1"); // intentId
    // New description should contain original + refinement
    const newDesc: string = updateCall[1];
    expect(newDesc).toContain("Looking for a React developer");
    expect(newDesc).toContain("Frontend focus");
    expect(newDesc).toContain("Senior level");
    expect(newDesc).toContain("Must know TypeScript well");

    expect(deps.enqueueHydeRegeneration).toHaveBeenCalledTimes(1);
    const hydeCall = (deps.enqueueHydeRegeneration as ReturnType<typeof mock>).mock.calls[0][0];
    expect(hydeCall.intentId).toBe("int-1");
    expect(hydeCall.userId).toBe("u-1");
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

    expect(deps.updateIntentDescription).not.toHaveBeenCalled();
  });
});
