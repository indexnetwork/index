/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";

import { NegotiationSummarizer, buildFallbackDigest } from "../negotiation.summarizer.js";
import type { DiscoveryNegotiation } from "../../opportunity/question.prompt.js";

const summarizer = new NegotiationSummarizer();

const richNegotiation: DiscoveryNegotiation = {
  counterpartyId: "user-bob",
  // Intentionally verbose: nudges the LLM toward an over-length counterpartyHint
  // if it didn't faithfully truncate the input. The fix slices on parse, so the
  // returned digest must still satisfy `.max(120)` regardless.
  counterpartyHint:
    "Senior staff engineer who has spent fourteen years building distributed databases, real-time analytics platforms, and high-throughput streaming infrastructure across both startups and FAANG; previously led a 30-person platform team responsible for the global write path of a top-five social network.",
  indexContext:
    "A focused community of AI infrastructure builders, founding engineers, and ML platform leads who are actively looking for collaborators on agentic systems, LLM eval pipelines, and retrieval architectures.",
  turns: [
    {
      action: "propose",
      reasoning:
        "Source operates an AI startup and is hiring a founding ML engineer with production LLM experience; counterparty has shipped retrieval pipelines and vector index systems at scale, so the seed assessment is strong. Proposing the connection with both as peers initially.",
      suggestedRoles: { ownUser: "peer", otherUser: "peer" },
    },
    {
      action: "counter",
      reasoning:
        "Counterparty pushes back on the peer framing — wants to clarify whether the role is hands-on IC or eng-management, because that materially changes the fit. Suggests reframing as patient (source needs help) / agent (counterparty provides it).",
      suggestedRoles: { ownUser: "patient", otherUser: "agent" },
    },
    {
      action: "accept",
      reasoning:
        "Source confirms an IC-heavy founding role with optional tech-lead progression — that aligns with what the counterparty wants right now. Roles agreed.",
      suggestedRoles: { ownUser: "patient", otherUser: "agent" },
    },
  ],
  outcome: {
    hasOpportunity: true,
    reasoning:
      "Strong technical fit; the candidate's retrieval-infra background maps directly onto what source needs to ship. The role-framing pivot from peer → patient/agent was the decisive moment — without it the negotiation would have stalled on ambiguity about seniority and scope.",
    agreedRoles: [
      { userId: "user-alice", role: "patient" },
      { userId: "user-bob", role: "agent" },
    ],
  },
};

describe("buildFallbackDigest — screened_out passthrough (P2.2, pure)", () => {
  it("preserves reason screened_out instead of coercing to stalled", () => {
    const digest = buildFallbackDigest({
      counterpartyId: "user-bob",
      counterpartyHint: "AI infra founder, Berlin",
      indexContext: "Builders network",
      turns: [],
      outcome: {
        hasOpportunity: false,
        reasoning: "Gate declined: generic overlap, no concrete angle.",
        reason: "screened_out",
      },
    });

    expect(digest.outcomeRole).toBe("no-opportunity");
    expect(digest.outcomeReason).toBe("screened_out");
    expect(digest.keyTake).toContain("Gate declined");
  });
});

describe("NegotiationSummarizer", () => {
  it("returns a digest with clamped fields when the LLM call succeeds", async () => {
    const result = await summarizer.summarize(richNegotiation);
    expect(result).not.toBeNull();
    if (!result) return;

    // Schema guarantees these (the fix clamps on parse), but assert explicitly
    // so a regression in the schema-side clamp would fail here, not silently.
    expect(result.counterpartyHint.length).toBeLessThanOrEqual(120);
    expect(result.counterpartyHint.length).toBeGreaterThan(0);
    expect(result.indexContext.length).toBeLessThanOrEqual(120);
    expect(result.indexContext.length).toBeGreaterThan(0);
    expect(result.keyTake.length).toBeLessThanOrEqual(180);
    expect(result.keyTake.length).toBeGreaterThan(0);
    expect(result.outcomeRole).toBe("opportunity");
    expect(result.outcomeReason).toBeNull();
  }, 60_000);

  it("emits a no-opportunity digest for a stalled negotiation", async () => {
    const stalled: DiscoveryNegotiation = {
      ...richNegotiation,
      counterpartyId: "user-cara",
      turns: [
        {
          action: "propose",
          reasoning: "Source proposes connection on AI infra collaboration.",
          suggestedRoles: { ownUser: "peer", otherUser: "peer" },
        },
        {
          action: "counter",
          reasoning:
            "Counterparty's stated focus is consumer mobile UX, which doesn't overlap with source's infra work. Asks for clarification but signals low intent.",
          suggestedRoles: { ownUser: "peer", otherUser: "peer" },
        },
      ],
      outcome: {
        hasOpportunity: false,
        reasoning:
          "Domain mismatch — infra vs. consumer mobile. No concrete overlap surfaced in either turn; counterparty's signals trend disengaged.",
        reason: "turn_cap",
      },
    };

    const result = await summarizer.summarize(stalled);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.outcomeRole).toBe("no-opportunity");
    expect(result.outcomeReason).not.toBeNull();
    expect(result.keyTake.length).toBeLessThanOrEqual(180);
  }, 60_000);
});
