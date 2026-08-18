/**
 * negotiations/domain — negotiator stance contracts (IND-611).
 *
 * The acting negotiator prompt is structurally biased toward producing matches
 * rather than finding valuable ones: it frames the job as advocacy, treats a
 * discovery-query match as a mandate to connect, and carries no
 * opportunity-cost term — the only decline bar is the purely negative "does not
 * serve {userName}'s needs", so absence of harm reads as grounds to accept.
 *
 * `NEGOTIATOR_STANCE` makes that stance configurable instead of hard-coded:
 *
 * | stance      | framing                              | value bar        | query rule              | consult propensity      | evidence provenance      | responder check          | deadlock  |
 * |-------------|--------------------------------------|------------------|-------------------------|-------------------------|--------------------------|--------------------------|-----------|
 * | `advocate`  | argue the case (today)               | none             | mandate (today)         | none (today)            | none (today)             | none (today)             | bargain   |
 * | `evaluator` | assess first, advocate if it survives | opportunity-cost | necessary-not-sufficient| prefer over assumption  | own record ≠ client's evidence | verify the opening | bargain   |
 * | `skeptic`   | + "most matches are not worth making" | opportunity-cost | necessary-not-sufficient| + unverified = don't proceed | (same — no sharpening) | + probe before accepting | stalemate |
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
 *
 * One family of fragments is the exception to that seat-blindness by
 * construction rather than by accident: the responder verification rules
 * (`stanceVerifiesResponderFit`) address a duty only the RESPONDING seat has —
 * reading someone else's opening — so `stanceActionRules` takes the seat and
 * renders them only there. They still name no action and no mechanism, so the
 * seat's own rules and the graph's grants stay the sole authority on what this
 * turn may actually do.
 *
 * The seat parameter is a scoping tool, not a licence to fork: a duty both
 * seats hold stays in the shared prefix even when the failure that motivated it
 * showed up on one seat. `EVIDENCE_PROVENANCE_RULE` is the case in point — it
 * was written for a responder accept, and it renders seat-blind, because an
 * initiator can cite its own prior openings' claims exactly as readily.
 */

import type { NegotiationSeat } from "../shared/schemas/negotiation-state.schema.js";

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

/**
 * Whether this stance asks the RESPONDING seat to verify the opening's account
 * of the fit before accepting it, rather than reading that account as evidence.
 */
export function stanceVerifiesResponderFit(stance: NegotiatorStance): boolean {
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
 * Consult propensity — assessing stances only.
 *
 * The assessing stances demand a judgment ("is this actually worth making for
 * {userName}?") that sometimes turns on a fact only the client holds: their
 * current priorities, their real constraints, what "alignment" would mean to
 * them. The legacy failure mode is resolving that gap by assumption —
 * guessing, conceding, or accepting on vibes. This rule names the resolution
 * path instead: consult the client.
 *
 * Deliberately names no action and no mechanism: like every fragment here it
 * renders into all seats and protocol versions, including seats with no
 * consultation vocabulary, so the seat's own rules decide HOW a consultation
 * happens and whether one is still available this turn. This only sets when
 * the agent should WANT one — which is also why it stays conditional on the
 * uncertainty being client-resolvable: no "always"/"regardless" wording that
 * would fight the per-negotiation consultation cap
 * (`negotiationAskRoundsCap`).
 */
const CONSULT_PROPENSITY_RULE = `
- CONSULT, DON'T ASSUME: when your judgment turns on a fact about {userName}'s OWN intent that you do not hold — their current priorities, their real constraints, what "alignment" would actually mean to them — prefer consulting {userName} over resolving that uncertainty by assumption. Guessing their answer, conceding to keep things moving, or proceeding because nothing contradicts the match are all ways of deciding for them what only they can decide.`;

/**
 * `skeptic` sharpening of the consult rule, appended to the same bullet (the
 * same additive pattern as `SKEPTIC_FRAMING` over `EVALUATOR_FRAMING`): under
 * the not-worth-making prior an unverified alignment assumption is itself a
 * reason not to proceed, and consulting the client is how it gets verified.
 */
const SKEPTIC_CONSULT_SHARPENING = ` For you this is a gate, not a preference: an UNVERIFIED assumption that the two sides' intents actually align is a reason NOT to proceed, and consulting {userName} is how that assumption gets verified.`;

/**
 * Evidence provenance — assessing stances, BOTH seats.
 *
 * The third sibling of the consult-propensity and responder-verification
 * fragments, and written for the way the second one was formally obeyed and
 * substantively evaded. A responder accepted a first contact grounded — as the
 * responder rule demands — in its OWN side's record rather than in the
 * opening's characterization. But the record it reached for was its own prior
 * conclusions, surfaced through memory and prior dialogue: "{userName}'s
 * previous acceptances ... reinforce this strong alignment", from acceptances
 * this same negotiator had made under a weaker bar. Circular verification —
 * I accepted before, therefore accepting is grounded.
 *
 * So the rule the verification duty was missing: an agent's own output is not
 * its client's evidence. Verification grounds in what a PERSON authored — never
 * in what an agent concluded about them, on either side of the table. The
 * fragment names exactly the client-authored sections this prompt actually
 * renders (intents, profile, and the client's own answers between sessions),
 * so the ground it points at is one the negotiator can see.
 *
 * Two boundaries it deliberately does not cross:
 * - **It does not ban memory.** Memory keeps the job it has (advisory notes on
 *   how to argue, what has been asked, what each side said); what changes is
 *   only what may count as verification. A fragment that told the negotiator to
 *   ignore its memory would fight `renderNegotiatorMemorySection` rather than
 *   complete it.
 * - **It does not forbid resolving a repeat signal quickly.** The continuation
 *   policy in `negotiation.agent.ts` ("materially the same as one you
 *   previously evaluated ... you may resolve quickly") governs how much EFFORT
 *   a re-run deserves; this governs what counts as GROUNDS. The nearest
 *   existing neighbor is the IND-569 attribution policy — "do not treat their
 *   conclusions as decisions about this opportunity" — which scopes conclusions
 *   across opportunities; this scopes them across the decision/evidence line.
 *
 * No `skeptic` sharpening: the prior that most matches are not worth making
 * does not change what an unverified assertion is worth. It is worth nothing
 * under either assessing stance, and a sharpening here would only restate the
 * rule louder.
 *
 * Names no action and no mechanism, like every other fragment in this module.
 */
const EVIDENCE_PROVENANCE_RULE = `
- YOUR OWN RECORD IS DECISIONS, NOT EVIDENCE: your earlier turns, the connections you proposed or accepted on {userName}'s behalf, and the conclusions you carry in memory are YOUR record — decisions you made for them, reached under whatever bar you applied at the time. Leaning on one ("they have been open to this before", "the fit was already established") re-asserts a judgment instead of checking it, and reads your own past eagerness back as {userName}'s interest. Ground the fit in what a person stated for themselves: {userName}'s own intents, profile, and the answers they gave you directly on your side; the counterparty's own intents and profile on theirs. Prior dialogue and memory keep their job — what has already been asked, what each side actually said, how to pitch this one — but they are the history of the argument, not grounds for it. A fit that was not verified does not become verified by having been asserted before.`;

/**
 * Responder verification — assessing stances, RESPONDING seat only.
 *
 * Two structural gaps this closes, both visible in the failure it was written
 * for: a first-contact outreach accepted in one exchange, on reasoning that
 * restated the opening's own fit claim back as the reason for accepting.
 *
 * 1. The opening enters the prompt as if it were evidence. It is not: it is
 *    advocacy authored by the counterparty's agent, and its most load-bearing
 *    move is characterizing what THIS client wants. Nothing else in the prompt
 *    tells the responding seat to treat that characterization as a claim.
 * 2. `VALUE_BAR_RULE` has no bite in this seat. "Most matches are not worth
 *    making" reads as being about MAKING matches, and a responder frames its
 *    decision as "would my client be open to connecting?" — nearly costless,
 *    nearly certain to be yes. So the same opportunity-cost currency is
 *    restated in the terms this seat actually spends it: accepting puts a
 *    connection in front of the client for approval.
 *
 * Conditional by construction: the steer applies where the fit case RESTS on
 * the initiator's interpretation. A match the client's own criteria and the
 * counterparty's own evidence support independently may still be accepted on
 * first contact — which is why no "always"/"never accept" wording appears here
 * and a spec pins its absence.
 *
 * Names no action and no mechanism, like every other fragment in this module:
 * "one more exchange" and "consulting {userName}" describe the move, and the
 * seat's own rules decide which token carries it (and whether the grant for it
 * is even live this turn).
 */
const RESPONDER_VERIFICATION_RULE = `
- THE OPENING IS ADVOCACY, NOT EVIDENCE: what reached {userName} was written by the other side's agent to make this match sound worth taking, and its account of the fit — what {userName} is looking for, why the two sides line up — is that agent's CLAIM about {userName}, not a fact you have checked. Test it against {userName}'s OWN intent and against what the counterparty's own profile and intents actually show. Restating the opening's fit claim back as your reason is agreement, not verification.
- WHAT ACCEPTING SPENDS: accepting is not the free or agreeable option — it puts a connection in front of {userName} for approval and spends the same finite attention the bar above governs. "Would {userName} be open to connecting?" is a bar almost anything clears, and it is not the bar. An accept on the first exchange has to be grounded in what {userName} themselves stated they were looking for, met by evidence about the counterparty that stands up without the opening's reading of it. Where the case for fit still rests on how the other agent characterized {userName}'s needs, the cheap move is one more exchange — put the specific gap to them, or counter with what would have to be true — and where the doubt is about {userName}'s own criteria rather than the counterparty's evidence, consulting {userName} settles it instead.`;

/**
 * `skeptic` sharpening of the responder rule, appended to the same bullet (the
 * same additive pattern as `SKEPTIC_CONSULT_SHARPENING`): under the
 * not-worth-making prior, closing on the opening alone is the exception rather
 * than the default. The escape hatch is restated explicitly here because this
 * is where the pressure is highest and an over-read would turn a lean into a
 * ban on first-contact accepts.
 */
const SKEPTIC_RESPONDER_SHARPENING = ` For you an accept on the first exchange is the exception, not the default: where the fit case still rests on the opening's own characterization, probe once before accepting — one exchange costs the counterparty nothing and {userName} very little, while an accept you cannot ground spends their attention on a match no one has checked. Where {userName}'s stated criteria and the counterparty's own evidence carry the fit without that characterization, accepting straight away is still the right call.`;

/**
 * Extra action-rule lines contributed by the stance, appended after the seat's
 * own rules. Empty under `advocate` → byte-identical.
 *
 * `seat` scopes the responder verification rules to the seat that did NOT
 * open. Everything else here is seat-blind: the value bar, the consult
 * propensity and the evidence-provenance rule are duties of both seats, and
 * the seat parameter must not become a reason to fork them.
 *
 * Order matters twice over. The seat-blind rules come first, so the initiator's
 * rendering stays a strict PREFIX of the responder's — the invariant the stance
 * spec checks by subtraction. And provenance lands immediately before the
 * responder rules, so "ground the accept in what {userName} themselves stated"
 * is already qualified by whose statements count when the responder reads it.
 */
export function stanceActionRules(stance: NegotiatorStance, seat: NegotiationSeat): string {
  if (!stanceAppliesValueBar(stance)) return "";
  const consultRule = stance === "skeptic"
    ? CONSULT_PROPENSITY_RULE + SKEPTIC_CONSULT_SHARPENING
    : CONSULT_PROPENSITY_RULE;
  const responderRule = seat === "counterparty" && stanceVerifiesResponderFit(stance)
    ? RESPONDER_VERIFICATION_RULE + (stance === "skeptic" ? SKEPTIC_RESPONDER_SHARPENING : "")
    : "";
  return VALUE_BAR_RULE + consultRule + EVIDENCE_PROVENANCE_RULE + responderRule;
}

/**
 * `skeptic` sharpening of the pre-contact consultation rule (the turn-0 third
 * verdict). Appended to the base rule in `negotiation.agent.ts`, which renders
 * it only on an opening initiator turn that actually holds the grant — so
 * unlike every other fragment here this one is not seat- and version-blind,
 * and does not need to be: it can never reach a seat without the vocabulary.
 *
 * The base rule sets when consulting is warranted. This sets which way to lean
 * when it is genuinely a toss-up, and the skeptic's prior is what makes the
 * lean asymmetric: under "most matches are not worth making" a pass is the
 * cheap default, which is exactly why an unverified pass deserves the same
 * suspicion as an unverified acceptance. Both decide for the client.
 *
 * Names no action and no mechanism, like the rest of this module.
 */
const SKEPTIC_PRE_CONTACT_LEAN = ` When it is genuinely close, lean toward asking rather than passing. Your prior is that most matches are not worth making — which makes passing the cheap answer, and a pass you reached by GUESSING at {userName}'s own criteria decides for them just as much as a connection you made by guessing. Nothing has been spent yet: the pause costs the counterparty nothing and costs {userName} one question.`;

/**
 * Stance contribution to the pre-contact consultation rule. Empty under
 * `advocate` and `evaluator` — the base seat-level rule already states when
 * the verdict applies, and only the skeptic's not-worth-making prior changes
 * which way a close call should fall.
 */
export function stancePreContactConsultRule(stance: NegotiatorStance): string {
  return stance === "skeptic" ? SKEPTIC_PRE_CONTACT_LEAN : "";
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
