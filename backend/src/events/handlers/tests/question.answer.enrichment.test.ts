import { describe, it, expect, mock } from "bun:test";
import { createPremiseFromAnswerFactory, type PremiseCreatorDeps } from "../question.answer.enrichment";

function makeDeps(overrides?: Partial<PremiseCreatorDeps>): PremiseCreatorDeps {
  return {
    runPremiseLifecycle: mock(async () => ({ premise: { id: "prem-1" } })),
    emitPremiseCreated: mock(() => {}),
    ...overrides,
  };
}

describe("createPremiseFromAnswerFactory", () => {
  it("routes the answer through PremiseGraph lifecycle", async () => {
    const deps = makeDeps();
    const fn = createPremiseFromAnswerFactory(deps);

    await fn({
      userId: "u-1",
      questionId: "q-1",
      selectedOptions: ["Technical mentorship", "Career guidance"],
      freeText: "Specifically in AI/ML",
      sourceId: "prof-1",
    });

    expect(deps.runPremiseLifecycle).toHaveBeenCalledTimes(1);
    const call = (deps.runPremiseLifecycle as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call).toMatchObject({
      userId: "u-1",
      tier: "contextual",
      volatile: false,
      provenanceSource: "explicit",
      provenanceSourceId: "q-1",
      provenanceConfidence: 0.9,
    });
    expect(String(call.assertionText)).toContain("Technical mentorship");
    expect(String(call.assertionText)).toContain("Career guidance");
    expect(String(call.assertionText)).toContain("Specifically in AI/ML");
  });

  it("routes profile-answer premises through lifecycle with assignment-capable graph input", async () => {
    const deps = makeDeps();
    const fn = createPremiseFromAnswerFactory(deps);

    await fn({
      userId: "user-1",
      questionId: "question-1",
      selectedOptions: ["AI developer tools"],
      freeText: "especially protocol design",
      sourceId: "profile-1",
    });

    expect(deps.runPremiseLifecycle).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      assertionText: expect.stringContaining("AI developer tools"),
      tier: "contextual",
      volatile: false,
      provenanceSource: "explicit",
      provenanceSourceId: "question-1",
    }));
    expect((deps as unknown as Record<string, unknown>).createPremise).toBeUndefined();
    expect((deps as unknown as Record<string, unknown>).embedText).toBeUndefined();
  });

  it("emits PremiseEvents.onCreated after successful lifecycle creation", async () => {
    const deps = makeDeps();
    const fn = createPremiseFromAnswerFactory(deps);

    await fn({
      userId: "u-1",
      questionId: "q-1",
      selectedOptions: ["Option A"],
      sourceId: "prof-1",
    });

    expect(deps.emitPremiseCreated).toHaveBeenCalledTimes(1);
    expect((deps.emitPremiseCreated as ReturnType<typeof mock>).mock.calls[0]).toEqual(["prem-1", "u-1"]);
  });

  it("does not emit when lifecycle returns no premise", async () => {
    const deps = makeDeps({ runPremiseLifecycle: mock(async () => ({ error: "failed" })) });
    const fn = createPremiseFromAnswerFactory(deps);

    await fn({
      userId: "u-1",
      questionId: "q-1",
      selectedOptions: ["Option A"],
      sourceId: "prof-1",
    });

    expect(deps.emitPremiseCreated).not.toHaveBeenCalled();
  });

  it("handles answers with only selectedOptions (no freeText)", async () => {
    const deps = makeDeps();
    const fn = createPremiseFromAnswerFactory(deps);

    await fn({
      userId: "u-1",
      questionId: "q-1",
      selectedOptions: ["Solo option"],
      sourceId: "prof-1",
    });

    const call = (deps.runPremiseLifecycle as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.assertionText).toBe("Solo option");
  });

  it("handles free-text-only answers (empty selectedOptions)", async () => {
    const deps = makeDeps();
    const fn = createPremiseFromAnswerFactory(deps);

    await fn({
      userId: "u-1",
      questionId: "q-1",
      selectedOptions: [],
      freeText: "I prefer async communication",
      sourceId: "prof-1",
    });

    const call = (deps.runPremiseLifecycle as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.assertionText).toBe("I prefer async communication");
  });

  it("skips premise creation when answer has no content", async () => {
    const deps = makeDeps();
    const fn = createPremiseFromAnswerFactory(deps);

    await fn({
      userId: "u-1",
      questionId: "q-1",
      selectedOptions: [],
      freeText: "   ",
      sourceId: "prof-1",
    });

    expect(deps.runPremiseLifecycle).not.toHaveBeenCalled();
    expect(deps.emitPremiseCreated).not.toHaveBeenCalled();
  });
});
