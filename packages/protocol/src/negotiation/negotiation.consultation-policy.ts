import type { NegotiationAction, NegotiationProtocolVersion, NegotiationSeat } from "../shared/schemas/negotiation-state.schema.js";

/** Independent rollout modes for IND-508's deterministic consultation policy. */
export type NegotiationConsultationPolicyMode = "off" | "shadow" | "on";

/** Stable, content-free categories emitted by the consultation funnel. */
export type NegotiationConsultationReason =
  | "unresolved_owner_constraint"
  | "consequential_disclosure_permission"
  | "repeated_non_convergence"
  | "insufficient_commitment_authority";

/** The only data the policy may inspect: action/role enums and routing coordinates. */
export interface ConsultationEligibilityInput {
  protocolVersion: NegotiationProtocolVersion;
  seat: NegotiationSeat;
  isOpeningTurn: boolean;
  isFinalTurn: boolean;
  screenedOut: boolean;
  action: NegotiationAction;
  ownSuggestedRole: "agent" | "patient" | "peer" | undefined;
  priorActions: readonly NegotiationAction[];
  previouslyConsulted: boolean;
  hasExactResumeCoordinate: boolean;
  lifecycleValid: boolean;
}

export interface ConsultationEligibility {
  eligible: boolean;
  reason?: NegotiationConsultationReason;
}

/**
 * Read the centralized consultation-policy switch. Invalid, absent, and empty
 * values deliberately roll back to off.
 */
export function negotiationConsultationPolicyMode(): NegotiationConsultationPolicyMode {
  const raw = process.env.NEGOTIATION_CONSULTATION_POLICY_MODE;
  return raw === "shadow" || raw === "on" ? raw : "off";
}

/**
 * Pure IND-508 eligibility policy. It intentionally never sees user text,
 * evaluator output, profiles, IDs, prompts, or messages; only safe protocol
 * enums and the exact binding/lifecycle booleans supplied by the graph.
 */
export function assessConsultationEligibility(input: ConsultationEligibilityInput): ConsultationEligibility {
  if (
    input.protocolVersion !== "v2"
    || input.isOpeningTurn
    || input.isFinalTurn
    || input.screenedOut
    || input.previouslyConsulted
    || !input.hasExactResumeCoordinate
    || !input.lifecycleValid
    || isObviousTerminal(input.action)
  ) return { eligible: false };

  // A patient-side counter is a schema-constrained, source-safe signal that
  // the owner must decide whether a consequential disclosure or permission is
  // acceptable. This is reachable under the normal v2 action vocabulary; it
  // deliberately does not inspect or depend on a model-produced `ask_user`.
  if (input.ownSuggestedRole === "patient" && input.action === "counter") {
    return { eligible: true, reason: "consequential_disclosure_permission" };
  }
  // Preserve observability for a valid legacy ask_user draft; production
  // policy admission no longer depends on this action because the patient-side
  // counter rule above is schema-constrained and independently reachable.
  if (input.action === "ask_user") {
    return { eligible: true, reason: "consequential_disclosure_permission" };
  }

  // A repeated run of safe counter/question action enums means the parties are
  // not converging. This precedes action-local rules so the policy is stable.
  const trailingActions = [...input.priorActions, input.action].slice(-3);
  const trailingNonConvergent = trailingActions.length === 3
    && trailingActions.every((action) => action === "counter" || action === "question");
  if (trailingNonConvergent) {
    return { eligible: true, reason: "repeated_non_convergence" };
  }

  if (input.ownSuggestedRole === "agent" && input.action === "counter") {
    return { eligible: true, reason: "insufficient_commitment_authority" };
  }

  if (input.action === "question") {
    return { eligible: true, reason: "unresolved_owner_constraint" };
  }

  return { eligible: false };
}

/** Fixed source-safe inputs that still traverse the existing questioner guard. */
export function consultationPromptFor(reason: NegotiationConsultationReason): {
  disclosureSubject: string;
  draftQuestion: string;
} {
  switch (reason) {
    case "consequential_disclosure_permission":
      return { disclosureSubject: "your permission", draftQuestion: "May we share the information needed to explore this collaboration?" };
    case "repeated_non_convergence":
      return { disclosureSubject: "your priorities", draftQuestion: "Which trade-off matters most as we decide how to proceed?" };
    case "insufficient_commitment_authority":
      return { disclosureSubject: "your decision authority", draftQuestion: "What commitments may we make on your behalf?" };
    case "unresolved_owner_constraint":
      return { disclosureSubject: "your preferences", draftQuestion: "What outcome would you prefer?" };
  }
}

function isObviousTerminal(action: NegotiationAction): boolean {
  return action === "accept" || action === "reject" || action === "withdraw" || action === "decline";
}
