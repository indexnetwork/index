import { describe, it, expect } from "bun:test";

import { DISCOVERY_SYSTEM_PROMPT, buildDiscoveryQuestionPrompt } from "../questioner.discovery.prompt.js";
import type { DiscoveryQuestionInput } from "../../shared/schemas/discovery-question.schema.js";
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
    userContext: "Alex is a builder.",
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

describe("buildDiscoveryQuestionPrompt", () => {
  it("requires generated prompts to stand alone with discovery context", () => {
    expect(DISCOVERY_SYSTEM_PROMPT).toContain("Standalone prompt rule");
    expect(DISCOVERY_SYSTEM_PROMPT).toContain("Every generated `prompt` must be understandable outside the conversation where it was created");
    expect(DISCOVERY_SYSTEM_PROMPT).toContain("question text itself");
    expect(DISCOVERY_SYSTEM_PROMPT).toContain("original query");
    expect(DISCOVERY_SYSTEM_PROMPT).toContain("discovery pattern");
    expect(DISCOVERY_SYSTEM_PROMPT).toContain("connection pattern");
    expect(DISCOVERY_SYSTEM_PROMPT).toContain("concrete learned fact");
    expect(DISCOVERY_SYSTEM_PROMPT).toContain("Do not rely on `title`, UI labels, hidden metadata, or surrounding digest/chat text");
    expect(DISCOVERY_SYSTEM_PROMPT).toContain("For your AI crypto decentralized deep-tech search");
    expect(DISCOVERY_SYSTEM_PROMPT).toContain("Which area is most critical right now?");
  });

  it("includes the query verbatim", () => {
    const out = buildDiscoveryQuestionPrompt(makeInput({ query: "find me a Rust mentor" }));
    expect(out).toContain("find me a Rust mentor");
  });

  it("includes the summary counters using user-facing language", () => {
    const out = buildDiscoveryQuestionPrompt(makeInput({
      summary: {
        totalCandidates: 5,
        opportunitiesFound: 2,
        noOpportunityCount: 3,
        timeoutCount: 1,
        roleDistribution: { peer: 3, agent: 1, patient: 1 },
      },
    }));
    expect(out).toContain("5 people reviewed");
    expect(out).toContain("2 promising connections found");
    expect(out).toContain("3 reviews did not find enough fit");
    expect(out).toContain("1 needed more detail or time");
    expect(out).toContain("3 mutual collaborations");
    expect(out).toContain("1 where the user could offer help or expertise");
    expect(out).toContain("1 where the user seemed to be seeking help or expertise");
  });

  it("indicates absent chat context", () => {
    const out = buildDiscoveryQuestionPrompt(makeInput({ chatContext: undefined }));
    expect(out).toContain("(no chat context available)");
  });

  it("renders chat-context fields when present", () => {
    const chatContext: ChatContextDigest = {
      statedFacts: ["Pre-revenue", "Based in Berlin"],
      openQuestions: ["What stage?"],
      rejectionReasons: ["All US-based people"],
      surfacedFindings: ["Two people mentioned the same VC"],
    };
    const out = buildDiscoveryQuestionPrompt(makeInput({ chatContext }));
    expect(out).toContain("Pre-revenue");
    expect(out).toContain("What stage?");
    expect(out).toContain("All US-based people");
    expect(out).toContain("Two people mentioned the same VC");
  });

  it("includes the now timestamp", () => {
    const out = buildDiscoveryQuestionPrompt(makeInput({ now: "2026-12-25T00:00:00.000Z" }));
    expect(out).toContain("2026-12-25T00:00:00.000Z");
  });

  it("includes counterpartyHint, indexContext, and keyTake per digest", () => {
    const out = buildDiscoveryQuestionPrompt(makeInput({
      negotiationDigests: [makeDigest({
        counterpartyHint: "AI infra founder, Berlin",
        indexContext: "Builders network",
        keyTake: "Multiple people flagged a Series A funding gap.",
      })],
    }));
    expect(out).toContain("AI infra founder, Berlin");
    expect(out).toContain("Builders network");
    expect(out).toContain("Series A funding gap");
  });

  it("renders zero connection reviews without internal negotiation language", () => {
    const out = buildDiscoveryQuestionPrompt(makeInput({ negotiationDigests: [] }));
    expect(out).toContain("(no connection reviews)");
    expect(out).not.toContain("(no negotiations)");
  });



  it("redacts internal outcome reasons", () => {
    const out = buildDiscoveryQuestionPrompt(makeInput({
      negotiationDigests: [makeDigest({ outcomeReason: "turn_cap" })],
    }));
    expect(out).toContain("needed more detail");
    expect(out).not.toContain("turn_cap");
  });

  it("renders screened_out with user-facing copy and no protocol jargon (P2.2)", () => {
    const out = buildDiscoveryQuestionPrompt(makeInput({
      negotiationDigests: [makeDigest({ outcomeReason: "screened_out" })],
    }));
    expect(out).toContain("didn't look like a strong enough fit to pursue");
    expect(out).not.toContain("screened_out");
    expect(out).not.toContain("screen");
  });

  it("renders suggestedRoles as user-facing relationship signals", () => {
    const out = buildDiscoveryQuestionPrompt(makeInput({
      negotiationDigests: [makeDigest({
        suggestedRoles: { ownUser: "agent", otherUser: "patient" },
      })],
      summary: {
        totalCandidates: 1,
        opportunitiesFound: 1,
        noOpportunityCount: 0,
        timeoutCount: 0,
        roleDistribution: { agent: 1 },
      },
    }));
    expect(out).toContain("the user could offer help or expertise");
    expect(out).not.toContain("roles=");
    expect(out).not.toContain("agent");
    expect(out).not.toContain("patient");
  });
});
