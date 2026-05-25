import { describe, it, expect, mock } from "bun:test";
import { createPremiseFromAnswerFactory, type PremiseCreatorDeps } from "../question.answer.profile";

function makeDeps(overrides?: Partial<PremiseCreatorDeps>): PremiseCreatorDeps {
  return {
    createPremise: mock(async () => ({ id: "prem-1" })),
    embedText: mock(async () => [0.1, 0.2, 0.3]),
    emitPremiseCreated: mock(() => {}),
    ...overrides,
  };
}

describe("createPremiseFromAnswerFactory", () => {
  it("creates a premise with the answer as assertion text", async () => {
    const deps = makeDeps();
    const fn = createPremiseFromAnswerFactory(deps);

    await fn({
      userId: "u-1",
      questionId: "q-1",
      selectedOptions: ["Technical mentorship", "Career guidance"],
      freeText: "Specifically in AI/ML",
      sourceId: "prof-1",
    });

    expect(deps.createPremise).toHaveBeenCalledTimes(1);
    const call = (deps.createPremise as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.userId).toBe("u-1");
    expect(call.assertion.text).toContain("Technical mentorship");
    expect(call.assertion.text).toContain("Career guidance");
    expect(call.assertion.text).toContain("Specifically in AI/ML");
    expect(call.assertion.tier).toBe("contextual");
    expect(call.provenance.source).toBe("explicit");
    expect(call.provenance.sourceId).toBe("q-1");
    expect(call.provenance.confidence).toBe(0.9);
  });

  it("emits PremiseEvents.onCreated after successful creation", async () => {
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

  it("embeds the assertion text", async () => {
    const deps = makeDeps();
    const fn = createPremiseFromAnswerFactory(deps);

    await fn({
      userId: "u-1",
      questionId: "q-1",
      selectedOptions: ["Option A"],
      sourceId: "prof-1",
    });

    expect(deps.embedText).toHaveBeenCalledTimes(1);
    const embedCall = (deps.embedText as ReturnType<typeof mock>).mock.calls[0][0];
    expect(embedCall).toContain("Option A");
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

    const call = (deps.createPremise as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.assertion.text).toBe("Solo option");
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

    const call = (deps.createPremise as ReturnType<typeof mock>).mock.calls[0][0];
    expect(call.assertion.text).toBe("I prefer async communication");
  });
});
