import type { NegotiationTurn, NegotiationOutcome } from "../negotiations/negotiation.state.js";
import type { DiscoveryNegotiation, DiscoveryOutcome, DiscoverySummary, DiscoveryTurn, NegotiationRole } from "../../protocol/schemas/discovery-question.schema.js";

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
 * The negotiation's outcome reason, narrowed to the discovery vocabulary.
 *
 * Written as an allow-list rather than a deny-list so a new negotiation reason
 * cannot silently cross the boundary: anything discovery does not declare —
 * `agent_error`, `repetition`, whatever comes next — is dropped, and the caller
 * degrades to the unreasoned stall the digest already handles.
 */
function discoveryOutcomeReason(reason: NegotiationOutcome["reason"]): DiscoveryOutcome["reason"] | undefined {
  return reason === "turn_cap" || reason === "timeout" || reason === "screened_out" ? reason : undefined;
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
    // `agent_error` and `repetition` deliberately do not cross into the
    // discovery vocabulary: question generation reasons about why a DIALOGUE
    // did not conclude, and a run that stopped on repeated agent failures — or
    // on an agent reproducing a message already on the record — has nothing to
    // say about the match. Both degrade to the unreasoned stall the digest
    // already handles.
    ...(discoveryOutcomeReason(r.outcome.reason) ? { reason: discoveryOutcomeReason(r.outcome.reason) } : {}),
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
