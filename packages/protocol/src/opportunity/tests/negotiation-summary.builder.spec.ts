import { describe, it, expect } from "bun:test";
import {
  toDiscoveryNegotiation,
  buildDiscoverySummary,
  type NegotiationResolution,
} from "../negotiation-summary.builder.js";

const baseResolution: NegotiationResolution = {
  candidateUserId: "cand-1",
  counterpartyHint: "designer, Berlin",
  indexContext: "Founders network",
  turns: [
    {
      action: "propose",
      assessment: {
        reasoning: "let's pair on the redesign",
        suggestedRoles: { ownUser: "agent", otherUser: "patient" },
      },
    },
    {
      action: "accept",
      assessment: {
        reasoning: "happy to take it",
        suggestedRoles: { ownUser: "patient", otherUser: "agent" },
      },
    },
  ],
  outcome: {
    hasOpportunity: true,
    agreedRoles: [
      { userId: "source-1", role: "agent" },
      { userId: "cand-1", role: "patient" },
    ],
    reasoning: "alignment confirmed",
    turnCount: 2,
  },
};

describe("toDiscoveryNegotiation", () => {
  it("maps turns + outcome from negotiation shapes to DiscoveryNegotiation shape", () => {
    const d = toDiscoveryNegotiation(baseResolution);
    expect(d.counterpartyId).toBe("cand-1");
    expect(d.counterpartyHint).toBe("designer, Berlin");
    expect(d.indexContext).toBe("Founders network");
    expect(d.turns).toEqual([
      {
        action: "propose",
        reasoning: "let's pair on the redesign",
        suggestedRoles: { ownUser: "agent", otherUser: "patient" },
      },
      {
        action: "accept",
        reasoning: "happy to take it",
        suggestedRoles: { ownUser: "patient", otherUser: "agent" },
      },
    ]);
    expect(d.outcome.hasOpportunity).toBe(true);
    expect(d.outcome.reasoning).toBe("alignment confirmed");
    expect(d.outcome.agreedRoles).toEqual([
      { userId: "source-1", role: "agent" },
      { userId: "cand-1", role: "patient" },
    ]);
  });

  it("preserves turn_cap reason on outcome", () => {
    const d = toDiscoveryNegotiation({
      ...baseResolution,
      outcome: { ...baseResolution.outcome, hasOpportunity: false, reason: "turn_cap" },
    });
    expect(d.outcome.hasOpportunity).toBe(false);
    expect(d.outcome.reason).toBe("turn_cap");
  });

  it("omits agreedRoles when outcome lacks opportunity", () => {
    const d = toDiscoveryNegotiation({
      ...baseResolution,
      outcome: { hasOpportunity: false, agreedRoles: [], reasoning: "no fit", turnCount: 1 },
    });
    expect(d.outcome.agreedRoles).toBeUndefined();
  });
});

describe("buildDiscoverySummary", () => {
  const ok = (overrides: Partial<NegotiationResolution> = {}): NegotiationResolution => ({
    ...baseResolution,
    candidateUserId: overrides.candidateUserId ?? baseResolution.candidateUserId,
    outcome: overrides.outcome ?? baseResolution.outcome,
    turns: overrides.turns ?? baseResolution.turns,
    counterpartyHint: overrides.counterpartyHint ?? baseResolution.counterpartyHint,
    indexContext: overrides.indexContext ?? baseResolution.indexContext,
  });

  it("counts opportunities, no-ops, and turn-cap timeouts", () => {
    const summary = buildDiscoverySummary([
      ok(),
      ok({
        candidateUserId: "c2",
        outcome: { hasOpportunity: false, agreedRoles: [], reasoning: "x", turnCount: 6, reason: "turn_cap" },
      }),
      ok({
        candidateUserId: "c3",
        outcome: { hasOpportunity: false, agreedRoles: [], reasoning: "x", turnCount: 0, reason: "timeout" },
      }),
      ok({
        candidateUserId: "c4",
        outcome: { hasOpportunity: false, agreedRoles: [], reasoning: "x", turnCount: 3 },
      }),
    ]);
    expect(summary.totalCandidates).toBe(4);
    expect(summary.opportunitiesFound).toBe(1);
    expect(summary.noOpportunityCount).toBe(3);
    expect(summary.timeoutCount).toBe(2);
  });

  it("aggregates roleDistribution across all agreedRoles entries", () => {
    const summary = buildDiscoverySummary([
      ok({
        candidateUserId: "c1",
        outcome: {
          hasOpportunity: true,
          agreedRoles: [
            { userId: "source-1", role: "agent" },
            { userId: "c1", role: "patient" },
          ],
          reasoning: "ok",
          turnCount: 2,
        },
      }),
      ok({
        candidateUserId: "c2",
        outcome: {
          hasOpportunity: true,
          agreedRoles: [
            { userId: "source-1", role: "peer" },
            { userId: "c2", role: "peer" },
          ],
          reasoning: "ok",
          turnCount: 2,
        },
      }),
    ]);
    expect(summary.roleDistribution).toEqual({ agent: 1, patient: 1, peer: 2 });
  });
});
