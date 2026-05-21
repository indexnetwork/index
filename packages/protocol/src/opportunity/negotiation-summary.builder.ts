/**
 * Pure mappers from raw per-candidate negotiation data to the protocol's
 * `DiscoveryNegotiation` / `DiscoverySummary` shapes consumed by the question
 * generator. No DB access, no LLM — safe to import from anywhere.
 */
import type {
  NegotiationTurn,
  NegotiationOutcome,
} from "../negotiation/negotiation.state.js";
import type {
  DiscoveryNegotiation,
  DiscoveryOutcome,
  DiscoverySummary,
  DiscoveryTurn,
  NegotiationRole,
} from "./question.prompt.js";

/**
 * The input shape collected by the opportunity graph's negotiate node for
 * each candidate that completed a negotiation attempt (accepted, rejected,
 * stalled, or errored).
 */
export interface NegotiationResolution {
  candidateUserId: string;
  /** Abstract profile slice for the LLM (e.g. "AI infra founder, Berlin"). */
  counterpartyHint: string;
  /** Network/community prompt for the negotiation. */
  indexContext: string;
  turns: NegotiationTurn[];
  outcome: NegotiationOutcome;
  /** Optional pre-negotiation evaluator score (0..1). */
  seedAssessmentScore?: number;
}

/**
 * Convert one negotiation resolution to `DiscoveryNegotiation`.
 *
 * @param r - The raw resolution from the negotiate node.
 * @returns A `DiscoveryNegotiation` ready for the question generator.
 */
export function toDiscoveryNegotiation(r: NegotiationResolution): DiscoveryNegotiation {
  const turns: DiscoveryTurn[] = r.turns.map((t) => ({
    action: t.action,
    reasoning: t.assessment.reasoning,
    suggestedRoles: {
      ownUser: t.assessment.suggestedRoles.ownUser as NegotiationRole,
      otherUser: t.assessment.suggestedRoles.otherUser as NegotiationRole,
    },
  }));
  const outcome: DiscoveryOutcome = {
    hasOpportunity: r.outcome.hasOpportunity,
    reasoning: r.outcome.reasoning,
    ...(r.outcome.hasOpportunity && r.outcome.agreedRoles.length > 0
      ? { agreedRoles: r.outcome.agreedRoles.map((a) => ({ userId: a.userId, role: a.role as NegotiationRole })) }
      : {}),
    ...(r.outcome.reason ? { reason: r.outcome.reason } : {}),
  };
  return {
    counterpartyId: r.candidateUserId,
    counterpartyHint: r.counterpartyHint,
    indexContext: r.indexContext,
    turns,
    outcome,
    ...(r.seedAssessmentScore !== undefined ? { seedAssessmentScore: r.seedAssessmentScore } : {}),
  };
}

/**
 * Aggregate counters across all negotiations in a single discovery turn.
 *
 * @param resolutions - All resolved negotiations from the negotiate node.
 * @returns A `DiscoverySummary` with totals and role distribution.
 */
export function buildDiscoverySummary(resolutions: NegotiationResolution[]): DiscoverySummary {
  const roleDistribution: Partial<Record<NegotiationRole, number>> = {};
  let opportunitiesFound = 0;
  let noOpportunityCount = 0;
  let timeoutCount = 0;

  for (const r of resolutions) {
    if (r.outcome.hasOpportunity) {
      opportunitiesFound += 1;
      for (const role of r.outcome.agreedRoles) {
        const key = role.role as NegotiationRole;
        roleDistribution[key] = (roleDistribution[key] ?? 0) + 1;
      }
    } else {
      noOpportunityCount += 1;
      if (r.outcome.reason === "turn_cap" || r.outcome.reason === "timeout") {
        timeoutCount += 1;
      }
    }
  }

  return {
    totalCandidates: resolutions.length,
    opportunitiesFound,
    noOpportunityCount,
    timeoutCount,
    roleDistribution,
  };
}
