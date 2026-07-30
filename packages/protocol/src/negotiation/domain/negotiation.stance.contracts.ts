/**
 * negotiation/domain — negotiator stance contracts (IND-611).
 *
 * The acting negotiator prompt is structurally biased toward producing matches
 * rather than finding valuable ones: it frames the job as advocacy, treats a
 * discovery-query match as a mandate to connect, and carries no
 * opportunity-cost term — the only decline bar is the purely negative "does not
 * serve {userName}'s needs", so absence of harm reads as grounds to accept.
 *
 * `NEGOTIATOR_STANCE` makes that stance configurable instead of hard-coded:
 *
 * | stance      | framing                              | value bar        | query rule              | deadlock  |
 * |-------------|--------------------------------------|------------------|-------------------------|-----------|
 * | `advocate`  | argue the case (today)               | none             | mandate (today)         | bargain   |
 * | `evaluator` | assess first, advocate if it survives | opportunity-cost | necessary-not-sufficient| bargain   |
 * | `skeptic`   | + "most matches are not worth making" | opportunity-cost | necessary-not-sufficient| stalemate |
 *
 * Design constraints (hard):
 * - **`advocate` is byte-identical.** Every fragment below is additive and
 *   gated; under `advocate` each renderer returns the exact legacy string, so
 *   the rendered prompt is byte-for-byte the pre-IND-611 build. Existing prompt
 *   specs are the guard.
 * - **Prompt-only.** The stance changes drafting stance and nothing else:
 *   no seat vocabulary change (`allowedActionsFor`), no schema change, no graph
 *   routing change. In particular the continuation-screen bypass at
 *   `negotiation.graph.ts` (`!state.continuationExecution`) is identical under
 *   all three stances — deliberately deferred so evals isolate wording as the
 *   single variable.
 * - **Domain layer.** Placed here (not in `application/`) so both the
 *   application-layer agent and the domain-layer deadlock renderer can read the
 *   stance without a domain → application cycle.
 * - **Fail-safe default.** Unset or unrecognized falls back to `advocate`
 *   (today's behavior), same operational pattern as `configuredScreenMode()`.
 *
 * Fragments deliberately never contain the literal `ask_user` or a quoted
 * `"withdraw"`: they render into every seat and protocol version, and the seat
 * specs pin that those tokens appear only where the seat legally holds them.
 */

export const NEGOTIATOR_STANCES = ["advocate", "evaluator", "skeptic"] as const;

export type NegotiatorStance = (typeof NEGOTIATOR_STANCES)[number];

export const DEFAULT_NEGOTIATOR_STANCE: NegotiatorStance = "advocate";

/**
 * Resolve the negotiator stance from `NEGOTIATOR_STANCE`.
 *
 * Defaults to `advocate` when unset or unrecognized — the stance shift is an
 * explicit opt-in flip (same operational pattern as `NEGOTIATION_SCREEN_MODE` /
 * `NEGOTIATION_PROTOCOL_VERSION`): the code ships dark, the environment turns
 * it on.
 */
export function configuredNegotiatorStance(): NegotiatorStance {
  const raw = process.env.NEGOTIATOR_STANCE;
  if (raw === "advocate" || raw === "evaluator" || raw === "skeptic") return raw;
  return DEFAULT_NEGOTIATOR_STANCE;
}

/** Whether this stance applies the opportunity-cost value bar. */
export function stanceAppliesValueBar(stance: NegotiatorStance): boolean {
  return stance !== "advocate";
}

/**
 * Whether this stance treats a discovery-query match as a precondition for
 * continuing to evaluate rather than as a mandate to connect.
 */
export function stanceQueryMatchIsNecessaryNotSufficient(stance: NegotiatorStance): boolean {
  return stance !== "advocate";
}

/** Whether a detected deadlock resolves by stalemate rather than bargaining. */
export function stanceResolvesDeadlockByStalemate(stance: NegotiatorStance): boolean {
  return stance === "skeptic";
}

// ─── Prompt fragments ────────────────────────────────────────────────────────

/**
 * The `advocate` job framing — byte-identical to the pre-IND-611 sentence that
 * followed "Your job: Evaluate whether this connection genuinely serves
 * {userName}'s interests given their role." in the system prompt.
 */
const ADVOCATE_FRAMING = `Argue their case honestly — acknowledge weaknesses, but advocate for genuine fit.`;

/**
 * `evaluator`: assessment precedes advocacy. Advocacy is still available — it is
 * conditioned on the match surviving an honest judgment first.
 */
const EVALUATOR_FRAMING = `Assess before you advocate: first form an honest judgment about whether this connection is actually worth making for {userName}. Advocate only for a match that survives that judgment, and say so plainly when one does not.`;

/**
 * `skeptic`: the evaluator framing plus an explicit prior. Borrows the finite-
 * attention framing already proven in the outreach gate prompt
 * (`negotiation.screen.ts`) — {userName}'s name and attention are spent on
 * every connection made for them.
 */
const SKEPTIC_FRAMING = `${EVALUATOR_FRAMING} Start from the prior that most candidate matches are NOT worth making: {userName}'s attention is finite and a mediocre connection costs them more than no connection. The burden is on the match to earn their time, not on you to find a way to say yes.`;

/**
 * The job-framing sentence for a stance. Under `advocate` this is the exact
 * legacy sentence, so the rendered prompt is byte-identical.
 *
 * `{userName}` placeholders are left intact for the caller's existing global
 * replace.
 */
export function stanceJobFraming(stance: NegotiatorStance): string {
  switch (stance) {
    case "evaluator":
      return EVALUATOR_FRAMING;
    case "skeptic":
      return SKEPTIC_FRAMING;
    default:
      return ADVOCATE_FRAMING;
  }
}

/**
 * The opportunity-cost value bar, appended as an extra action rule.
 *
 * Today the only decline bar in the prompt is "does not serve {userName}'s
 * needs" — a purely negative test, so absence of harm reads as grounds to
 * proceed. This adds the missing positive bar without touching any seat's
 * action vocabulary.
 */
const VALUE_BAR_RULE = `
- OPPORTUNITY COST: {userName}'s attention is finite and their name is spent on every connection made on their behalf. The bar is "worth that spend", not "does no harm" — absence of a downside is NOT a reason to proceed. Ask what {userName} gives up by spending this attention here instead of on a better match, and say no when the answer is "too much".`;

/**
 * Extra action-rule lines contributed by the stance, appended after the seat's
 * own rules. Empty under `advocate` → byte-identical.
 */
export function stanceActionRules(stance: NegotiatorStance): string {
  return stanceAppliesValueBar(stance) ? VALUE_BAR_RULE : "";
}

/**
 * The discovery-query satisfaction rule.
 *
 * `advocate` keeps today's mandate wording verbatim ("PROPOSE or ACCEPT the
 * connection…"), which converts a filter into an instruction to connect.
 * `evaluator`/`skeptic` make query satisfaction necessary-but-not-sufficient: a
 * precondition for continuing to evaluate, never itself a reason to connect.
 *
 * Names are interpolated eagerly here: this fragment is spliced into the system
 * prompt *after* the caller's global `{userName}` substitution has already run,
 * so a placeholder would survive into the rendered prompt.
 */
export function stanceQuerySatisfiedRule(
  stance: NegotiatorStance,
  otherName: string,
  userName: string,
): string {
  if (!stanceQueryMatchIsNecessaryNotSufficient(stance)) {
    return `- If ${otherName} DOES satisfy the query: PROPOSE or ACCEPT the connection and evaluate fit normally using intents and profile data.`;
  }
  return `- If ${otherName} DOES satisfy the query: satisfying the query is a PRECONDITION for continuing to evaluate, NOT a reason to connect. Keep evaluating fit on intents and profile data, and decline when the connection would not be worth ${userName}'s attention.`;
}
