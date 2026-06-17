import { describe, it, expect } from "bun:test";
import { buildDiscoveryQuestionInput } from "../discovery-question.helper.js";
import type { ChatContextDigest } from "../../shared/schemas/chat-context.schema.js";
import type { DiscoveryNegotiationDigest } from "../../shared/schemas/negotiation-digest.schema.js";
import type { DiscoverySummary } from "../question.prompt.js";

const digest: DiscoveryNegotiationDigest = {
  counterpartyHint: "founder, NYC",
  indexContext: "ai-builders",
  outcomeRole: "no-opportunity",
  outcomeReason: "stalled",
  keyTake: "No fit on stage.",
  suggestedRoles: { ownUser: "peer", otherUser: "peer" },
};

const summary: DiscoverySummary = {
  totalCandidates: 1,
  opportunitiesFound: 0,
  noOpportunityCount: 1,
  timeoutCount: 0,
  roleDistribution: {},
};

describe("buildDiscoveryQuestionInput", () => {
  it("maps query, user context, negotiation digests, summary, and timestamp", () => {
    const input = buildDiscoveryQuestionInput({
      query: "find AI cofounders",
      userContext: "Eda is an engineer in NYC, skilled in ml, interested in startups.",
      negotiationDigests: [digest],
      summary,
      chatContext: undefined,
      now: "2026-05-15T12:00:00.000Z",
    });
    expect(input.query).toBe("find AI cofounders");
    expect(input.userContext).toBe("Eda is an engineer in NYC, skilled in ml, interested in startups.");
    expect(input.negotiationDigests).toEqual([digest]);
    expect(input.summary).toEqual(summary);
    expect(input.now).toBe("2026-05-15T12:00:00.000Z");
    expect(input.chatContext).toBeUndefined();
  });

  it("forwards a provided chatContext digest verbatim", () => {
    const ctx: ChatContextDigest = {
      statedFacts: ["pre-revenue"],
      openQuestions: [],
      rejectionReasons: [],
      surfacedFindings: [],
    };
    const input = buildDiscoveryQuestionInput({
      query: "q",
      userContext: "",
      negotiationDigests: [],
      summary,
      chatContext: ctx,
      now: "2026-05-15T12:00:00.000Z",
    });
    expect(input.chatContext).toEqual(ctx);
  });

  it("passes an empty user context through unchanged", () => {
    const input = buildDiscoveryQuestionInput({
      query: "q",
      userContext: "",
      negotiationDigests: [],
      summary,
      chatContext: undefined,
      now: "2026-05-15T12:00:00.000Z",
    });
    expect(input.userContext).toBe("");
  });
});
