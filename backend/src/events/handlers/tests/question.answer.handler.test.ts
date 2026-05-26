import { describe, it, expect, mock, beforeEach } from "bun:test";
import {
  handleQuestionAnswered,
  type QuestionAnswerHandlerDeps,
} from "../question.answer.handler";

function makeDeps(overrides?: Partial<QuestionAnswerHandlerDeps>): QuestionAnswerHandlerDeps {
  return {
    createPremiseFromAnswer: mock(async () => {}),
    enqueueIntentRefinement: mock(async () => {}),
    storeNegotiationContext: mock(async () => {}),
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
    expect(deps.storeNegotiationContext).not.toHaveBeenCalled();
  });

  it("calls createPremiseFromAnswer for profile mode", async () => {
    await handleQuestionAnswered(
      { ...basePayload, mode: "profile", sourceType: "profile", sourceId: "prof-1" },
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

  it("calls storeNegotiationContext for negotiation mode", async () => {
    await handleQuestionAnswered(
      { ...basePayload, mode: "negotiation", sourceType: "opportunity", sourceId: "opp-1" },
      deps,
    );
    expect(deps.storeNegotiationContext).toHaveBeenCalledTimes(1);
    const call = (deps.storeNegotiationContext as ReturnType<typeof mock>).mock.calls[0];
    expect(call[0]).toEqual({
      userId: "u-1",
      opportunityId: "opp-1",
      questionId: "q-1",
      selectedOptions: ["Option A"],
      freeText: undefined,
    });
  });

  it("swallows errors from handlers without rethrowing", async () => {
    const failDeps = makeDeps({
      createPremiseFromAnswer: mock(async () => { throw new Error("DB down"); }),
    });
    // Should not throw
    await handleQuestionAnswered(
      { ...basePayload, mode: "profile", sourceType: "profile", sourceId: "prof-1" },
      failDeps,
    );
    expect(failDeps.createPremiseFromAnswer).toHaveBeenCalledTimes(1);
  });

  it("handles unknown mode gracefully", async () => {
    await handleQuestionAnswered(
      { ...basePayload, mode: "unknown_mode" as "discovery" },
      deps,
    );
    expect(deps.createPremiseFromAnswer).not.toHaveBeenCalled();
    expect(deps.enqueueIntentRefinement).not.toHaveBeenCalled();
    expect(deps.storeNegotiationContext).not.toHaveBeenCalled();
  });
});
