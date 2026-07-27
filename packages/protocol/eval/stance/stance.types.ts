import type { NegotiatorStance } from "../../src/negotiation/domain/negotiation.stance.contracts.js";
import type { NegotiationTurn, UserNegotiationContext } from "../../src/negotiation/domain/negotiation.state.js";

/**
 * Ground-truth value label for a fixture.
 *
 * - `high` — a genuinely valuable match. Declining it is a false negative: the
 *   cost of a more skeptical stance.
 * - `low`  — plausible on the surface (shared topic, overlapping vocabulary)
 *   but not actually worth the client's attention: adjacency rather than fit,
 *   one-sided value, or a stage/scope mismatch. Declining it is the win.
 */
export type FixtureValue = "high" | "low";

/** One bilateral negotiation scenario, played by both seats under one stance. */
export interface StanceCase {
  id: string;
  value: FixtureValue;
  /** Why this fixture carries its label — the eval's own reasoning, never sent to the model. */
  rationale: string;
  source: UserNegotiationContext;
  candidate: UserNegotiationContext;
  seedAssessment: { reasoning: string; valencyRole: string };
  networkPrompt: string;
  /** Explicit discovery query from the source side, when the scenario has one. */
  discoveryQuery?: string;
}

/** Terminal classification of one played-out negotiation. */
export type NegotiationVerdict = "accepted" | "declined" | "stalled";

/** One played-out negotiation under one stance. */
export interface StanceRunResult {
  caseId: string;
  value: FixtureValue;
  stance: NegotiatorStance;
  run: number;
  verdict: NegotiationVerdict;
  /** The terminal action, or null when the run hit the turn cap. */
  terminalAction: string | null;
  turns: NegotiationTurn[];
  /** True when the initiator refused on turn 0 (only reachable after the IND-611 prerequisite). */
  refusedAtTurnZero: boolean;
  error?: string;
}

/** Per-stance aggregate over all runs. */
export interface StanceScore {
  stance: NegotiatorStance;
  lowValue: BucketScore;
  highValue: BucketScore;
  /** declineRate(low) − declineRate(high). Higher is better: discrimination, not blanket pessimism. */
  discrimination: number;
  turnZeroRefusals: number;
}

export interface BucketScore {
  runs: number;
  declined: number;
  accepted: number;
  stalled: number;
  errors: number;
  /** declined / runs. Runs that errored are excluded from the denominator. */
  declineRate: number;
}
