import { describe, it, expect } from "bun:test";

import {
  SYSTEM_PROMPT,
  buildQuestionPrompt,
  type DiscoveryQuestionInput,
} from "../question.prompt.js";
import type { DiscoveryNegotiationDigest } from "../../shared/schemas/negotiation-digest.schema.js";
import type { ChatContextDigest } from "../../shared/schemas/chat-context.schema.js";

function makeDigest(overrides: Partial<DiscoveryNegotiationDigest> = {}): DiscoveryNegotiationDigest {
  return {
    counterpartyHint: "Backend engineer in Berlin",
    indexContext: "Builders looking for co-founders",
    outcomeRole: "no-opportunity",
    outcomeReason: "stalled",
    keyTake: "Both backend-heavy, no clear stage alignment.",
    suggestedRoles: { ownUser: "peer", otherUser: "peer" },
    ...overrides,
  };
}

function makeInput(overrides: Partial<DiscoveryQuestionInput> = {}): DiscoveryQuestionInput {
  return {
    query: "I'm looking for a technical co-founder",
    sourceProfile: { name: "Alex" },
    negotiationDigests: [makeDigest()],
    summary: {
      totalCandidates: 1,
      opportunitiesFound: 0,
      noOpportunityCount: 1,
      timeoutCount: 0,
      roleDistribution: { peer: 1 },
    },
    now: "2026-05-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildQuestionPrompt", () => {
  it("requires generated prompts to stand alone with discovery context", () => {
    expect(SYSTEM_PROMPT).toContain("Standalone prompt rule");
    expect(SYSTEM_PROMPT).toContain("Every generated `prompt` must be understandable outside the conversation where it was created");
    expect(SYSTEM_PROMPT).toContain("question text itself");
    expect(SYSTEM_PROMPT).toContain("original query");
    expect(SYSTEM_PROMPT).toContain("discovery pattern");
    expect(SYSTEM_PROMPT).toContain("negotiation pattern");
    expect(SYSTEM_PROMPT).toContain("concrete learned fact");
    expect(SYSTEM_PROMPT).toContain("Do not rely on `title`, UI labels, hidden metadata, or surrounding digest/chat text");
    expect(SYSTEM_PROMPT).toContain("For your AI crypto decentralized deep-tech search");
    expect(SYSTEM_PROMPT).toContain("Which area is most critical right now?");
  });

  it("includes the query verbatim", () => {
    const out = buildQuestionPrompt(makeInput({ query: "find me a Rust mentor" }));
    expect(out).toContain("find me a Rust mentor");
  });

  it("includes the summary counters", () => {
    const out = buildQuestionPrompt(makeInput({
      summary: {
        totalCandidates: 5,
        opportunitiesFound: 2,
        noOpportunityCount: 3,
        timeoutCount: 1,
        roleDistribution: { peer: 3, agent: 1, patient: 1 },
      },
    }));
    expect(out).toContain("5 candidates evaluated");
    expect(out).toContain("2 opportunities found");
    expect(out).toContain("3 ended without opportunity");
    expect(out).toContain("1 hit turn-cap/timeout");
  });

  it("indicates absent chat context", () => {
    const out = buildQuestionPrompt(makeInput({ chatContext: undefined }));
    expect(out).toContain("(no chat context available)");
  });

  it("renders chat-context fields when present", () => {
    const chatContext: ChatContextDigest = {
      statedFacts: ["Pre-revenue", "Based in Berlin"],
      openQuestions: ["What stage?"],
      rejectionReasons: ["All US-based candidates"],
      surfacedFindings: ["Two candidates mentioned the same VC"],
    };
    const out = buildQuestionPrompt(makeInput({ chatContext }));
    expect(out).toContain("Pre-revenue");
    expect(out).toContain("What stage?");
    expect(out).toContain("All US-based candidates");
    expect(out).toContain("Two candidates mentioned the same VC");
  });

  it("includes the now timestamp", () => {
    const out = buildQuestionPrompt(makeInput({ now: "2026-12-25T00:00:00.000Z" }));
    expect(out).toContain("2026-12-25T00:00:00.000Z");
  });

  it("includes counterpartyHint, indexContext, and keyTake per digest", () => {
    const out = buildQuestionPrompt(makeInput({
      negotiationDigests: [makeDigest({
        counterpartyHint: "AI infra founder, Berlin",
        indexContext: "Builders network",
        keyTake: "Multiple candidates flagged a Series A funding gap.",
      })],
    }));
    expect(out).toContain("AI infra founder, Berlin");
    expect(out).toContain("Builders network");
    expect(out).toContain("Series A funding gap");
  });

  it("renders zero negotiations as '(no negotiations)'", () => {
    const out = buildQuestionPrompt(makeInput({ negotiationDigests: [] }));
    expect(out).toContain("(no negotiations)");
  });

  it("renders outcomeReason when present", () => {
    const out = buildQuestionPrompt(makeInput({
      negotiationDigests: [makeDigest({ outcomeReason: "turn_cap" })],
    }));
    expect(out).toContain("turn_cap");
  });

  it("renders suggestedRoles when present", () => {
    const out = buildQuestionPrompt(makeInput({
      negotiationDigests: [makeDigest({
        suggestedRoles: { ownUser: "agent", otherUser: "patient" },
      })],
    }));
    expect(out).toContain("agent");
    expect(out).toContain("patient");
  });
});
