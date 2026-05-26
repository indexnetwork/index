import { describe, it, expect, mock } from "bun:test";
import { storeNegotiationContextFactory, type NegotiationContextDeps } from "../question.answer.negotiation";

function makeDeps(overrides?: Partial<NegotiationContextDeps>): NegotiationContextDeps {
  return {
    getOpportunity: mock(async () => ({
      id: "opp-1",
      status: "negotiating",
      metadata: {},
    })),
    updateOpportunityMetadata: mock(async () => {}),
    ...overrides,
  };
}

describe("storeNegotiationContextFactory", () => {
  it("appends answer context to opportunity metadata", async () => {
    const deps = makeDeps();
    const fn = storeNegotiationContextFactory(deps);

    await fn({
      userId: "u-1",
      opportunityId: "opp-1",
      questionId: "q-1",
      selectedOptions: ["Accept the terms"],
      freeText: "But only if timeline is Q3",
    });

    expect(deps.updateOpportunityMetadata).toHaveBeenCalledTimes(1);
    const call = (deps.updateOpportunityMetadata as ReturnType<typeof mock>).mock.calls[0];
    expect(call[0]).toBe("opp-1");
    const metadata = call[1];
    expect(metadata.userAnswers).toHaveLength(1);
    expect(metadata.userAnswers[0].questionId).toBe("q-1");
    expect(metadata.userAnswers[0].selectedOptions).toEqual(["Accept the terms"]);
    expect(metadata.userAnswers[0].freeText).toBe("But only if timeline is Q3");
  });

  it("skips if opportunity not found", async () => {
    const deps = makeDeps({ getOpportunity: mock(async () => null) });
    const fn = storeNegotiationContextFactory(deps);

    await fn({
      userId: "u-1",
      opportunityId: "opp-404",
      questionId: "q-1",
      selectedOptions: ["A"],
    });

    expect(deps.updateOpportunityMetadata).not.toHaveBeenCalled();
  });

  it("skips if opportunity is not in a negotiable status", async () => {
    const deps = makeDeps({
      getOpportunity: mock(async () => ({
        id: "opp-1",
        status: "rejected",
        metadata: {},
      })),
    });
    const fn = storeNegotiationContextFactory(deps);

    await fn({
      userId: "u-1",
      opportunityId: "opp-1",
      questionId: "q-1",
      selectedOptions: ["A"],
    });

    expect(deps.updateOpportunityMetadata).not.toHaveBeenCalled();
  });

  it("preserves existing userAnswers when appending", async () => {
    const deps = makeDeps({
      getOpportunity: mock(async () => ({
        id: "opp-1",
        status: "negotiating",
        metadata: {
          userAnswers: [{ questionId: "q-old", selectedOptions: ["Old"], answeredAt: "t" }],
        },
      })),
    });
    const fn = storeNegotiationContextFactory(deps);

    await fn({
      userId: "u-1",
      opportunityId: "opp-1",
      questionId: "q-2",
      selectedOptions: ["New"],
    });

    const metadata = (deps.updateOpportunityMetadata as ReturnType<typeof mock>).mock.calls[0][1];
    expect(metadata.userAnswers).toHaveLength(2);
    expect(metadata.userAnswers[0].questionId).toBe("q-old");
    expect(metadata.userAnswers[1].questionId).toBe("q-2");
  });
});
