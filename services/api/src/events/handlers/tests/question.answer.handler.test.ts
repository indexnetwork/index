import { describe, it, expect, mock, beforeEach } from "bun:test";
import { handleQuestionAnswered, type QuestionAnswerHandlerDeps } from "../question.answer.handler";

function makeDeps(overrides?: Partial<QuestionAnswerHandlerDeps>): QuestionAnswerHandlerDeps {
  return {
    createPremiseFromAnswer: mock(async () => {}),
    enqueueIntentRefinement: mock(async () => ({ applied: true })),
    resumeInflightNegotiation: mock(async () => {}),
    resolveChatQuestionWait: mock(() => {}),
    handlePoolAnswer: mock(async () => {}),
    ...overrides,
  };
}

const basePayload = {
  questionId: "q-1",
  userId: "u-1",
  sourceType: "discovery",
  sourceId: "sess-1",
  answer: {
    selectedOptions: ["Option A"],
    freeText: undefined,
    answeredBy: "u-1",
    answeredAt: "2026-05-25T12:00:00.000Z",
  },
};

describe("handleQuestionAnswered", () => {
  let deps: QuestionAnswerHandlerDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("does nothing for discovery mode (context flows via chat)", async () => {
    await handleQuestionAnswered({ ...basePayload, mode: "discovery" }, deps);
    expect(deps.createPremiseFromAnswer).not.toHaveBeenCalled();
    expect(deps.enqueueIntentRefinement).not.toHaveBeenCalled();
  });

  it("calls createPremiseFromAnswer for enrichment mode", async () => {
    await handleQuestionAnswered(
      { ...basePayload, mode: "enrichment", sourceType: "profile", sourceId: "prof-1" },
      deps,
    );
    expect(deps.createPremiseFromAnswer).toHaveBeenCalledTimes(1);
    const call = (deps.createPremiseFromAnswer as ReturnType<typeof mock>).mock.calls[0];
    expect(call[0]).toEqual({
      userId: "u-1",
      questionId: "q-1",
      selectedOptions: ["Option A"],
      freeText: undefined,
      sourceId: "prof-1",
    });
  });

  it("calls enqueueIntentRefinement for intent mode", async () => {
    await handleQuestionAnswered(
      { ...basePayload, mode: "intent", sourceType: "intent", sourceId: "int-1" },
      deps,
    );
    expect(deps.enqueueIntentRefinement).toHaveBeenCalledTimes(1);
    const call = (deps.enqueueIntentRefinement as ReturnType<typeof mock>).mock.calls[0];
    expect(call[0]).toEqual({
      userId: "u-1",
      intentId: "int-1",
      questionId: "q-1",
      selectedOptions: ["Option A"],
      freeText: undefined,
    });
  });

  it("carries the expected recovery fingerprint into the intent refinement guard", async () => {
    await handleQuestionAnswered(
      {
        ...basePayload, mode: "intent", purpose: "recovery", sourceType: "intent", sourceId: "int-1",
        recoveryIntentFingerprint: "fingerprint-1",
      },
      deps,
    );
    expect(deps.enqueueIntentRefinement).toHaveBeenCalledWith({
      userId: "u-1", intentId: "int-1", questionId: "q-1",
      selectedOptions: ["Option A"], freeText: undefined,
      expectedIntentFingerprint: "fingerprint-1",
    });
  });

  it("resolves the chat wait bus for chat mode", async () => {
    await handleQuestionAnswered(
      { ...basePayload, mode: "chat", sourceType: "conversation", sourceId: "sess-1" },
      deps,
    );
    expect(deps.resolveChatQuestionWait).toHaveBeenCalledTimes(1);
    const call = (deps.resolveChatQuestionWait as ReturnType<typeof mock>).mock.calls[0];
    expect(call[0]).toEqual({
      questionId: "q-1",
      answer: basePayload.answer,
    });
    expect(deps.createPremiseFromAnswer).not.toHaveBeenCalled();
    expect(deps.enqueueIntentRefinement).not.toHaveBeenCalled();
  });

  it("does not perform negotiation mutation outside the authoritative adapter boundary", async () => {
    await handleQuestionAnswered(
      { ...basePayload, mode: "negotiation", sourceType: "opportunity", sourceId: "opp-1" },
      deps,
    );
    expect(deps.resumeInflightNegotiation).not.toHaveBeenCalled();
  });

  it("does not repeat shared mutation after authoritative ordinary settlement", async () => {
    await handleQuestionAnswered({
      ...basePayload,
      mode: "negotiation",
      purpose: "stalled_followup",
      sourceType: "opportunity",
      sourceId: "opp-1",
      settlement: { authoritative: true, purpose: "stalled_followup", taskId: "task-old", resumeClaimed: false },
    }, deps);
    expect(deps.resumeInflightNegotiation).not.toHaveBeenCalled();
  });

  it("keeps uptake answers private to the question row", async () => {
    await handleQuestionAnswered(
      { ...basePayload, mode: "negotiation", purpose: "uptake", sourceType: "opportunity", sourceId: "opp-1" },
      deps,
    );
  });

  it("swallows errors from handlers without rethrowing", async () => {
    const failDeps = makeDeps({
      createPremiseFromAnswer: mock(async () => { throw new Error("DB down"); }),
    });
    // Should not throw
    await handleQuestionAnswered(
      { ...basePayload, mode: "enrichment", sourceType: "profile", sourceId: "prof-1" },
      failDeps,
    );
    expect(failDeps.createPremiseFromAnswer).toHaveBeenCalledTimes(1);
  });

  it("fails closed for inflight events without an authoritative exact-task claim", async () => {
    await handleQuestionAnswered(
      { ...basePayload, mode: "negotiation_inflight", sourceType: "opportunity", sourceId: "opp-1" },
      deps,
    );
    expect(deps.resumeInflightNegotiation).not.toHaveBeenCalled();
    expect(deps.resolveChatQuestionWait).not.toHaveBeenCalled();
  });

  it("resumes only the exact DB-claimed inflight task", async () => {
    await handleQuestionAnswered({
      ...basePayload,
      mode: "negotiation_inflight",
      purpose: "inflight_consultation",
      sourceType: "opportunity",
      sourceId: "opp-1",
      settlement: { authoritative: true, purpose: "inflight_consultation", taskId: "task-exact", resumeClaimed: true },
    }, deps);
    expect(deps.resumeInflightNegotiation).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-exact",
      opportunityId: "opp-1",
    }));
  });

  it("does not resume when answer lost the answer-vs-timeout claim", async () => {
    await handleQuestionAnswered({
      ...basePayload,
      mode: "negotiation_inflight",
      purpose: "inflight_consultation",
      sourceType: "opportunity",
      sourceId: "opp-1",
      settlement: { authoritative: true, purpose: "inflight_consultation", taskId: "task-stale", resumeClaimed: false },
    }, deps);
    expect(deps.resumeInflightNegotiation).not.toHaveBeenCalled();
  });

  it("resumeInflightNegotiation failure is caught, not thrown", async () => {
    deps = makeDeps({ resumeInflightNegotiation: mock(async () => { throw new Error("boom"); }) });
    await handleQuestionAnswered(
      {
        ...basePayload,
        mode: "negotiation_inflight",
        purpose: "inflight_consultation",
        sourceType: "opportunity",
        sourceId: "opp-1",
        settlement: { authoritative: true, purpose: "inflight_consultation", taskId: "task-exact", resumeClaimed: true },
      },
      deps,
    );
    expect(deps.resumeInflightNegotiation).toHaveBeenCalledTimes(1);
  });

  it("routes pool_discovery through the complete pool-answer reaction", async () => {
    await handleQuestionAnswered(
      {
        ...basePayload,
        mode: "pool_discovery",
        sourceType: "intent",
        sourceId: "intent-1",
        answer: { ...basePayload.answer, freeText: "Prefer a short engagement" },
      },
      deps,
    );
    expect(deps.handlePoolAnswer).toHaveBeenCalledTimes(1);
    expect((deps.handlePoolAnswer as ReturnType<typeof mock>).mock.calls[0]?.[0]).toEqual({
      userId: "u-1",
      questionId: "q-1",
      intentId: "intent-1",
      selectedOptions: ["Option A"],
      freeText: "Prefer a short engagement",
    });
  });

  it("handles unknown mode gracefully", async () => {
    await handleQuestionAnswered(
      { ...basePayload, mode: "unknown_mode" as "discovery" },
      deps,
    );
    expect(deps.createPremiseFromAnswer).not.toHaveBeenCalled();
    expect(deps.enqueueIntentRefinement).not.toHaveBeenCalled();
  });
});
