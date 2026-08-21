import type { NegotiationAction, NegotiationConsultationReason, NegotiationProtocolVersion, NegotiationSeat } from "../shared/schemas/negotiation-state.schema.js";

export type { NegotiationConsultationReason } from "../shared/schemas/negotiation-state.schema.js";

/** Independent rollout modes for IND-508's deterministic consultation policy. */
export type NegotiationConsultationPolicyMode = "off" | "shadow" | "on";

/** The only data the policy may inspect: action/role enums and routing coordinates. */
export interface ConsultationEligibilityInput {
  protocolVersion: NegotiationProtocolVersion;
  seat: NegotiationSeat;
  isOpeningTurn: boolean;
  isFinalTurn: boolean;
  action: NegotiationAction;
  ownSuggestedRole: "agent" | "patient" | "peer" | undefined;
  priorActions: readonly NegotiationAction[];
  /**
   * Whether the acting principal's question budget for this negotiation is
   * spent (checklist plan §3 rule 5). Under the checklist protocol that is
   * `QUESTION_BUDGET_PER_PRINCIPAL` questions per principal, the turn-0
   * pre-contact consult included; under `advocate` it is the legacy
   * one-consultation ration, which is the same test with a budget of one — so
   * this stayed one boolean rather than becoming a count the policy would have
   * to interpret. The policy still sees no text, no ids and no counts.
   */
  consultationBudgetSpent: boolean;
  hasExactResumeCoordinate: boolean;
  lifecycleValid: boolean;
}

export interface ConsultationEligibility {
  eligible: boolean;
  reason?: NegotiationConsultationReason;
}

/** The deterministic consultation policy is on. */
export const NEGOTIATION_CONSULTATION_POLICY_MODE: NegotiationConsultationPolicyMode = "on";

/**
 * Pure IND-508 eligibility policy. It intentionally never sees user text,
 * evaluator output, profiles, IDs, prompts, or messages; only safe protocol
 * enums and the exact binding/lifecycle booleans supplied by the graph.
 */
export function assessConsultationEligibility(input: ConsultationEligibilityInput): ConsultationEligibility {
  if (
    input.protocolVersion !== "v2"
    || input.isFinalTurn
    || input.consultationBudgetSpent
    || !input.hasExactResumeCoordinate
    || !input.lifecycleValid
    || isObviousTerminal(input.action)
  ) return { eligible: false };

  // ─── Pre-contact consultation (the opening turn) ──────────────────────────
  // Before this branch the opening turn was a blanket exclusion, so the
  // initiator's turn-0 vocabulary was binary: reach out, or pass with the
  // counterparty never contacted. A third verdict is admissible when the
  // blocking doubt is one only the client can settle — how their own criteria
  // bound the search — and the pause costs the counterparty nothing, because
  // nothing has been sent.
  //
  // The admission is deliberately NARROW, and narrower than the mid-flight
  // rules below:
  //
  //  - INITIATOR ONLY. A turn-0 counterparty seat (tie-break inheritance) is
  //    responding to an outreach, so its client's criteria are not what is
  //    blocking; there is no pre-contact position to protect either.
  //  - A MODEL-AUTHORED `ask_user` ONLY. Every rule below infers a
  //    consultation from a draft that asked for something else, which needs
  //    history to be a safe inference — and at turn 0 there is none. The
  //    acting agent is the only party that has read the client's own signal,
  //    so the pre-contact case is the one where volunteering the pause is the
  //    evidence, not a substitute for it. This also keeps the distinction the
  //    graph prompt draws — client-resolvable scope doubt consults;
  //    counterparty evidence that contradicts the match passes silently —
  //    resolvable HERE only as "the agent did not ask", which is exactly what
  //    a contradiction-shaped doubt produces.
  //
  // The category is fixed rather than read off the draft: a pre-contact pause
  // is by construction an unresolved constraint the OWNER controls. The
  // consult counts as an ordinary ask round (the graph reads the same
  // `negotiationAskRoundsCap` substrate before granting the action at all).
  if (input.isOpeningTurn) {
    return input.seat === "initiator" && input.action === "ask_user"
      ? { eligible: true, reason: "unresolved_owner_constraint" }
      : { eligible: false };
  }

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
      return { disclosureSubject: "your permission", draftQuestion: "May I share the information needed to explore this collaboration?" };
    case "repeated_non_convergence":
      return { disclosureSubject: "your priorities", draftQuestion: "Which trade-off matters most as I decide how to proceed?" };
    case "insufficient_commitment_authority":
      return { disclosureSubject: "your decision authority", draftQuestion: "What commitments may I make on your behalf?" };
    case "unresolved_owner_constraint":
      return { disclosureSubject: "your preferences", draftQuestion: "What outcome would you prefer?" };
  }
}

function isObviousTerminal(action: NegotiationAction): boolean {
  return action === "accept" || action === "reject" || action === "withdraw" || action === "decline";
}

// ─── Pre-contact consultation: bounds and recognition ────────────────────────

/**
 * How many pre-contact consultations one intent may hold OPEN at once.
 *
 * A vague signal can surface many candidates in a batch, and the doubt that
 * blocks the first ("does 'academic linguistics' strictly bound this, or is
 * adjacent depth in scope?") is usually the same doubt that blocks all of
 * them. One answer generalizes: it lands in the signal's DM, and the DM is
 * injected into every later turn-0 decision on that signal. The cap exists
 * for the agent that does not internalize that and would interrogate its
 * client candidate-by-candidate.
 *
 * Two, not one: a second genuinely different question about the same signal
 * is plausible, a third is a pattern. Past the cap the action is simply not
 * offered and the seat falls back to today's binary reach-out-or-pass.
 */
export const MAX_OPEN_PRE_CONTACT_CONSULTS_PER_INTENT = 2;

/**
 * Whether a negotiation's own turns show it has never contacted the
 * counterparty — every turn it holds is a client-consultation park.
 *
 * This is what makes a post-consult resume still-the-opening. A mid-flight
 * consult always has an `outreach` behind it (the counterparty seat cannot
 * even speak before one), so this is false for every park the pre-contact
 * verdict did not create, and the resume rules it gates stay off the
 * mid-flight path by construction rather than by a flag.
 */
export function isPreContactConsultResume(turns: readonly { action: NegotiationAction }[]): boolean {
  return turns.length > 0 && turns.every((turn) => turn.action === "ask_user");
}

/**
 * Turn-context key stamped on a pre-contact park. Written at park time beside
 * the ask-user binding, read back by {@link countOpenPreContactConsults} — the
 * park row is the only durable record of the consultation, so the marker lives
 * with it rather than in a separate counter that could drift.
 */
export const PRE_CONTACT_CONSULT_MARKER = "preContactConsult";

/** Minimal task shape the open-consult count reads; matches `getTasksForUser`. */
export interface PreContactConsultTaskRow {
  id: string;
  state: string;
  metadata: Record<string, unknown> | null;
}

/**
 * Count the pre-contact consultations currently open for one `(user, intent)`
 * scope, from the user's own negotiation tasks.
 *
 * "Open" is derived from the durable park itself — an `input_required` task
 * whose captured ask-user binding names this recipient pair and whose turn
 * context carries the pre-contact stamp — so answering, expiry, and resume all
 * retire a park from the count with no counter to keep in step. Mid-flight
 * consults carry no stamp and never count.
 */
export function countOpenPreContactConsults(
  tasks: readonly PreContactConsultTaskRow[],
  scope: { userId: string; intentId: string; excludeTaskId?: string },
): number {
  return tasks.filter((task) => {
    if (task.state !== "input_required" || task.id === scope.excludeTaskId) return false;
    const turnContext = task.metadata?.turnContext as Record<string, unknown> | undefined;
    if (turnContext?.[PRE_CONTACT_CONSULT_MARKER] !== true) return false;
    const binding = turnContext.askUserBinding as Record<string, unknown> | undefined;
    return binding?.recipientUserId === scope.userId && binding.recipientIntentId === scope.intentId;
  }).length;
}
