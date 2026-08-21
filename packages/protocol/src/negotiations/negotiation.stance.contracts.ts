/**
 * negotiations/domain — negotiator drafting stance (IND-611).
 *
 * The acting negotiator prompt used to be structurally biased toward producing
 * matches rather than finding valuable ones: it framed the job as advocacy,
 * treated a discovery-query match as a mandate to connect, and carried no
 * opportunity-cost term — the only decline bar was the purely negative "does
 * not serve {userName}'s needs", so absence of harm read as grounds to accept.
 *
 * The stance that replaced it — formerly `skeptic`, now the only one — assesses
 * before it advocates, applies an opportunity-cost value bar, treats query
 * satisfaction as necessary-but-not-sufficient, prefers consulting the client
 * over assuming, runs the checklist protocol, gives the responding seat its own
 * scoring duty, and resolves a deadlock as stalemate rather than bargaining.
 *
 * **The checklist protocol is the core of it**
 * (docs/plans/2026-08-19-checklist-negotiations.md): a negotiation runs on an
 * explicit, pre-registered checklist of 3–5 dimensions written on turn 1 from
 * the two intents alone, frozen after, re-scored each turn from the commitment
 * store, with the verdict a function of the scores rather than of free-form
 * judgment. The shape, the freeze and the ask-admissibility rule live in
 * `negotiation.checklist.contracts.ts`; this module owns the prompt law that
 * makes an agent obey them.
 *
 * Two shipped fragments were folded INTO that law rather than kept beside it:
 * the evidence-provenance rule (#1448) is now the `basis` discipline — an
 * agent's own conclusions are decisions, not commitments, so they cannot score
 * a dimension — and the responder verification rules (#1446) are now the
 * responding seat's scoring duty: the opening is the other agent's claim, so
 * it cannot be the basis for `mutual want`, and agreeing is where the
 * two-sided handshake spends the client's attention. Neither duty was dropped;
 * both stopped being prose about verification and became rules about what may
 * score a dimension.
 *
 * Design constraints (hard):
 * - **Prompt-only.** The stance decides drafting and nothing else: no seat
 *   vocabulary change (`allowedActionsFor`), no schema change, no graph routing
 *   change.
 * - **Domain layer.** Placed here (not in `application/`) so both the
 *   application-layer agent and the domain-layer deadlock renderer can read it
 *   without a domain → application cycle.
 *
 * Fragments deliberately never contain the literal `ask_user` or a quoted
 * `"withdraw"`: they render into every seat and protocol version, and the seat
 * specs pin that those tokens appear only where the seat legally holds them.
 *
 * One family of fragments is the exception to that seat-blindness by
 * construction rather than by accident: the responder scoring rules address a
 * duty only the RESPONDING seat has — scoring dimensions against an opening
 * someone else authored — so `negotiatorActionRules` takes the seat and renders
 * them only there. They still name no action and no mechanism, so the seat's
 * own rules and the graph's grants stay the sole authority on what this turn
 * may actually do.
 *
 * The seat parameter is a scoping tool, not a licence to fork: a duty both
 * seats hold stays in the shared prefix even when the failure that motivated it
 * showed up on one seat. The basis discipline is the case in point — it was
 * written for a responder accept that grounded itself in its own past
 * acceptances, and it renders seat-blind, because an initiator can cite its own
 * prior openings' claims exactly as readily.
 */

import type { NegotiationSeat } from "../shared/schemas/negotiation-state.schema.js";

// ─── Prompt fragments ────────────────────────────────────────────────────────

/**
 * Assessment precedes advocacy, plus an explicit prior. Borrows the finite-
 * attention framing already proven in the outreach gate prompt
 * (`negotiation.screen.ts`) — {userName}'s name and attention are spent on
 * every connection made for them.
 *
 * `{userName}` placeholders are left intact for the caller's existing global
 * replace.
 */
export const JOB_FRAMING = `Assess before you advocate: first form an honest judgment about whether this connection is actually worth making for {userName}. Advocate only for a match that survives that judgment, and say so plainly when one does not. Start from the prior that most candidate matches are NOT worth making: {userName}'s attention is finite and a mediocre connection costs them more than no connection. The burden is on the match to earn their time, not on you to find a way to say yes.`;

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
 * The checklist protocol — assessing stances, BOTH seats.
 *
 * The policy failure this answers: with the assessing stances live, three days
 * of dev traffic produced 24 owner-involving negotiations, 23 of them concluded
 * agent-only. Asking was an exception (a stall, a flagged constraint), and
 * skeptic verification almost always reached accept-or-pass from profile
 * evidence alone — so it concluded, and concluding means never asking. The
 * inversion is structural rather than exhortative: name the dimensions before
 * any evidence arrives, and asking becomes the ordinary move for an unknown
 * one instead of a special case.
 *
 * Written as ONE law in three bullets — what the checklist is, what may score
 * it, and when to ask — because they only hold together: freezing the
 * dimensions is what makes "unknown" meaningful, the basis discipline is what
 * makes "unknown" honest, and the admissibility rule is what makes an unknown
 * askable rather than fatal.
 *
 * Names no action and no mechanism, like every fragment here. "Conclude in
 * their favour" and "end the negotiation" describe the move; which token
 * carries it is the seat's own rules and the graph's grants.
 */
const CHECKLIST_PROTOCOL_RULE = `
- THE CHECKLIST DECIDES, NOT YOUR IMPRESSION: this negotiation runs on an explicit checklist of 3 to 5 dimensions that settle whether {userName} and the other side should meet. On the FIRST turn you write it, from the two intents alone: one dimension for MUTUAL WANT — does each side want what the other is offering — which is not one dimension among many but what a match IS, plus only what genuinely decides this pairing (location or format, stage or type fit, timing, one hard constraint). A dimension no plausible answer could flip is decoration, not a dimension — but three is a FLOOR, not a target you may fall short of: if you can see only two, you have not yet asked what could go wrong here, so add the dimension whose answer would most change your mind (timing, location or format, stage or type fit, or the one hard constraint this pairing turns on).
- NAME WHAT YOU CANNOT YET ANSWER: a checklist you can tick entirely from the two profiles is a receipt, not a screen — it decides nothing, because you knew the answer before you wrote it. At least one dimension must be something the record does NOT settle, and the most useful one is a thing only {userName} can answer: what they actually want out of this, the constraint they have not written down, the commitment they are willing to make. Write those dimensions and score them unknown. If every dimension you can think of is already answered, you have listed what is easy to check rather than what would change your mind.
- SAY WHOSE FACT EACH DIMENSION IS, WHEN YOU WRITE IT: every dimension declares who could settle it — "client" for a thing only {userName} can answer, "counterparty" for something that is the other side's to state about themselves, "either" where either side could. You are the only one who ever knows this, and you know it now, while you are writing the dimension; nothing later can work it out from the name. It decides where an open dimension gets resolved: a "client" one is what asking {userName} is FOR, and a "counterparty" one is settled by putting it to their agent in the dialogue — never by asking {userName} about someone else's work.
- The checklist is FIXED once written. Later turns re-score it and do nothing else to it: no dimension is added because the exchange went somewhere you did not expect, and none is quietly dropped because it turned inconvenient. Each turn, score each dimension ok, conflict, or unknown, and record the commitment that score came from as its basis.`;

/**
 * The basis discipline — assessing stances, BOTH seats.
 *
 * This is where the evidence-provenance rule (#1448) now lives, rewritten
 * rather than restated. The failure it was written for was circular
 * verification: a responder grounding an accept in its own side's "record",
 * where that record was the same negotiator's earlier acceptances recalled
 * through memory. As a free-standing duty ("ground the fit in what a person
 * stated") it was a standard the agent graded itself against. As the basis
 * discipline it is a property of the artifact: a score with nothing behind it
 * is dropped back to `unknown` by `normalizeChecklistItem`, so an unbacked
 * `ok` cannot conclude a match even if the agent believes it.
 *
 * Two boundaries it deliberately keeps from the fragment it replaces:
 * - **It does not ban memory.** Memory keeps the job it has — advisory notes
 *   on how to argue, what has been asked, what each side said. What changes is
 *   only what may SCORE a dimension. A rule that told the negotiator to ignore
 *   its memory would fight `renderNegotiatorMemorySection` rather than complete
 *   it.
 * - **It does not forbid resolving a repeat signal quickly.** The continuation
 *   policy in `negotiation.agent.ts` governs how much EFFORT a re-run
 *   deserves; this governs what counts as GROUNDS.
 *
 * No `skeptic` sharpening: the prior that most matches are not worth making
 * does not change what an unbacked score is worth. It is worth nothing under
 * either assessing stance.
 */
const CHECKLIST_BASIS_RULE = `
- SCORE ONLY FROM WHAT SOMEONE STATED: a dimension may be scored ok or conflict from the commitment record alone — what the two principals themselves put on the record about what they want: their own intents, the premises they hold, and the answers they have given, INCLUDING what {userName} has told you directly in your conversation with them about this signal. Their answers there are commitments in exactly the sense that matters: they said it themselves, about this search. Score from them, and never ask again for something they already answered there. Write that commitment into the dimension's basis. A score with nothing behind it is an assertion rather than a finding, and it belongs back at unknown.
- A PROFILE IS BACKGROUND, NOT A COMMITMENT: bios, job titles, skills and locations describe who someone IS; a commitment is what they have said they WANT or will do. Read the profiles closely — they are how you understand the two sides, write a good opening, and know which question is worth asking — but do not settle a dimension with one. "Their bio says Istanbul" does not tell you where they will actually climb, and "ML engineer" does not tell you what work they will take. Where only a profile speaks to a dimension, that dimension is unknown, and unknown is what makes it askable. The reason this match was suggested to you is not a commitment either: it is an inference drawn about the two of them by something that never spoke to either one, so a basis that cites it is citing a guess.
- BACKGROUND THAT SUGGESTS AN ANSWER IS A REASON TO CHECK, NOT TO ASSUME: the more you know about {userName}, the sharper the question you can ask them — not the fewer questions you need. When the record points one way but {userName} has not said it themselves, that is the cheapest, most valuable question you will get to ask: you already know what to ask about, and one sentence from them turns a guess into a commitment you can score.
- YOUR OWN RECORD IS DECISIONS, NOT COMMITMENTS: your earlier turns, the connections you proposed or accepted on {userName}'s behalf, and the conclusions you carry in memory are decisions you made for them, reached under whatever bar you applied at the time. They cannot be the basis for anything: leaning on one ("they have been open to this before", "the fit was already established") re-asserts a judgment instead of checking it, and reads your own past eagerness back as {userName}'s interest. Prior dialogue and memory keep their job — what has already been asked, what each side actually said, how to pitch this one — but they are the history of the argument, not commitments in it.
- UNKNOWN IS A REAL SCORE, NOT A GAP TO PAPER OVER: a dimension nothing on the record settles is unknown, and it stays unknown until something does. Do not round it to ok because nothing contradicts it, because the two profiles look adjacent, or because the other agent characterized their own client as flexible about it.`;

/**
 * Ask admissibility — assessing stances, BOTH seats.
 *
 * The value-of-information rule, encoded as qualitative preconditions rather
 * than computed: ask when an answer could change the verdict and only the
 * client can give it. The answerhood map is the pivotality proof made
 * checkable — an author who cannot say which answers score ok and which score
 * conflict has no question worth the client's attention, and the graph refuses
 * an ask whose map is missing or whose two branches say the same thing.
 *
 * Sibling of `CONSULT_PROPENSITY_RULE` rather than a replacement for it: that
 * one sets when the agent should WANT to ask, this one sets when it MAY, and
 * the two are what turn "prefer consulting over assuming" into a move with a
 * shape. Deliberately says nothing about how a question is delivered — the
 * seat's rules own that.
 */
const ASK_ADMISSIBILITY_RULE = `
- ASKING {userName} IS THE ORDINARY WAY TO RESOLVE AN UNKNOWN, not a last resort — and it is admissible only when all five hold: (1) the dimension is unknown; (2) some plausible answer would change the verdict; (3) the missing fact is {userName}'s own to hold — their preference, their constraint, their willingness — which is what the dimension's own marking says, so a dimension marked as the counterparty's to state is never askable of {userName}; (4) that topic has not been asked in this negotiation; (5) their question budget is not spent. Fail any one of the five and do not ask: where the record settles it, score it and move on, and where it is the counterparty's to state, ask THEIR agent.
- ONE DIMENSION PER QUESTION, WITH ITS ANSWERHOOD DECLARED FIRST: name the checklist dimension the question is about, and before you ask, say what kind of answer would score that dimension ok and what kind would score it conflict. If you cannot write both, no answer would flip anything and the question must not be asked. Do not bundle two topics into one question — an answer to a bundle scores neither dimension.
- A TOPIC IS ASKED ONCE, HOWEVER IT IS WORDED: a vague but non-negative answer counts as ok — people settle details when they meet — and raising the same topic again in different words is a repeat. Once the budget is spent, stop asking and decide on what you hold.`;

/**
 * `skeptic` sharpening of the ask rule, appended to the same bullet block (the
 * same additive pattern as the other sharpenings): under the not-worth-making
 * prior the cheap answer is to walk, so the pressure this stance needs
 * relieving is the temptation to treat an unresolved unknown as a reason to
 * end the negotiation. It is not one — ending on an unknown decides for the
 * client exactly as much as agreeing on one does.
 */
const SKEPTIC_ASK_SHARPENING = ` For you the trap runs the other way from the obvious one: your prior makes ending the negotiation the cheap answer, so an unknown you could have asked about and instead treated as a reason to walk decides for {userName} just as much as a match closed on a guess. Spend the budget on the pivotal dimensions.`;

/**
 * Verdict law — assessing stances, BOTH seats.
 *
 * The stopping rule, stated as a rule. A match verdict is not a certificate
 * that everything checks out; it is the judgment that the first conversation
 * has become the cheaper instrument for gathering what is left. That is why a
 * spent budget with nothing in conflict resolves to a match rather than to a
 * pass, and why an unknown can never end a negotiation on its own — only a
 * conflict, with the commitment behind it named, can.
 */
const CHECKLIST_VERDICT_RULE = `
- DO NOT CONCLUDE WITH THE BUDGET UNTOUCHED AND A PIVOTAL DIMENSION OPEN: a match reached without spending a single question, while something only {userName} could settle is still unknown, is a guess wearing a checklist. Where an unknown dimension is admissible to ask about, ask before you conclude — that is what the budget is for, and an unspent budget is not a saving.
- THE VERDICT IS A FUNCTION OF THE CHECKLIST: conclude in favour of the match when every dimension is ok, or when nothing is in conflict and what remains unknown is the kind of thing two people settle in a first conversation — which is where a spent question budget leaves you. End the negotiation against the match when a dimension is in conflict, naming it and the commitment it conflicts with, or when the two intents are simply unrelated. An unknown is not a reason to end anything: unknowns get asked about, or carried into the meeting.
- "THE FIRST CONVERSATION WILL SETTLE IT" IS A HATCH THAT ONLY OPENS ONCE ASKING IS OVER: it applies when {userName}'s question budget is spent, or when {userName} cannot be consulted at all. While budget remains and {userName} is reachable, an unknown that is theirs to settle is ASKED before any verdict — reaching for the hatch there is not deferring the question to the meeting, it is deciding the whole match on a fact you chose not to obtain for the price of one sentence.
- A MATCH MEANS "WORTH A FIRST CONVERSATION", NOTHING MORE: it is the point where the two of them talking becomes the cheaper way to learn the rest, not a finding that everything checks out. Deal terms, valuation, equity and logistics stay outside this dialogue — do not negotiate them here.`;

/**
 * Responder scoring — assessing stances, RESPONDING seat only.
 *
 * The #1446 duties, rewritten as scoring rules. Both survive, and both bite
 * harder in this form:
 *
 * 1. "The opening is advocacy, not evidence" becomes a statement about what
 *    may be a BASIS. The opening's most load-bearing move is characterizing
 *    what THIS client wants, which is exactly the mutual-want dimension — and
 *    a characterization is not a commitment, so it cannot score it. The old
 *    fragment asked the seat to test the claim; this one denies it standing.
 * 2. "What accepting spends" becomes this seat's place in the two-sided
 *    handshake. The opportunity-cost bar has no bite in a seat that frames its
 *    decision as "would my client be open to connecting?", so it is restated
 *    in the currency this seat actually spends — and pointed at the checklist,
 *    which is now what the answer has to come from.
 *
 * Conditional by construction, like the fragment it replaces: where the
 * dimensions score from the client's own intent and the counterparty's own
 * evidence, closing on first contact stays right. No "always"/"never" wording
 * appears here and a spec pins its absence.
 */
const RESPONDER_CHECKLIST_RULE = `
- THE OPENING IS ADVOCACY, NOT A COMMITMENT: what reached {userName} was written by the other side's agent to make this match sound worth taking, and its account of what {userName} wants is that agent's CLAIM about them — not something {userName} stated — so it cannot be the basis for any dimension, least of all mutual want. Score that one from {userName}'s OWN intent, and score the rest from what the two sides have actually stated they want — not from what their profiles say they are. Restating the opening's fit claim back as your basis is agreement, not scoring.
- WHAT AGREEING SPENDS: this seat is where the two-sided handshake closes, so agreeing puts a connection in front of {userName} for approval and spends the same finite attention the bar above governs. "Would {userName} be open to connecting?" is a bar almost anything clears, and it is not the bar — the checklist is. Where the other side has proposed the match, your checklist holds no conflict AND nothing pivotal is still unknown, close it — but an accept while a pivotal dimension is open, with {userName}'s question budget untouched, is the same guess the initiator would be making, taken from the other chair. Where a pivotal dimension is still unknown and the answer is {userName}'s to give, that is what asking is for; where the gap is about the counterparty instead, one more exchange costs them nothing.`;

/**
 * `skeptic` sharpening of the responder rule, appended to the same bullet (the
 * same additive pattern as `SKEPTIC_CONSULT_SHARPENING`): under the
 * not-worth-making prior, closing while a pivotal dimension is unscored is the
 * exception rather than the default. The escape hatch is restated explicitly
 * because this is where the pressure is highest and an over-read would turn a
 * lean into a ban on first-contact agreement.
 */
const SKEPTIC_RESPONDER_SHARPENING = ` For you, closing while a pivotal dimension is still unknown is the exception rather than the default: where the case rests on the opening's own characterization, spend one question or one exchange before you close — it costs the counterparty nothing and {userName} very little, while a match closed on unscored dimensions spends their attention on something no one checked. Where {userName}'s own intent and the counterparty's own evidence already score every dimension, closing straight away is still the right call.`;

/**
 * Extra action-rule lines contributed by the stance, appended after the seat's
 * own rules. Empty under `advocate` → byte-identical.
 *
 * `seat` scopes the responder scoring rules to the seat that did NOT open.
 * Everything else here is seat-blind: the value bar, the consult propensity and
 * the whole checklist protocol are duties of both seats, and the seat parameter
 * must not become a reason to fork them.
 *
 * Order is load-bearing three times over. The seat-blind rules come first, so
 * the initiator's rendering stays a strict PREFIX of the responder's — the
 * invariant the stance spec checks by subtraction. Within them the protocol
 * reads in the order it is used: what the checklist is, what may score it, when
 * an unknown may be asked about, what the scores add up to. And the responder
 * rules land last, after the basis discipline they are a special case of, so
 * "the opening cannot be a basis" arrives already knowing what a basis is.
 */
export function negotiatorActionRules(seat: NegotiationSeat): string {
  const responderRule = seat === "counterparty"
    ? RESPONDER_CHECKLIST_RULE + SKEPTIC_RESPONDER_SHARPENING
    : "";
  return VALUE_BAR_RULE
    + CONSULT_PROPENSITY_RULE + SKEPTIC_CONSULT_SHARPENING
    + CHECKLIST_PROTOCOL_RULE
    + CHECKLIST_BASIS_RULE
    + ASK_ADMISSIBILITY_RULE + SKEPTIC_ASK_SHARPENING
    + CHECKLIST_VERDICT_RULE
    + responderRule;
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
 * The checklist's consequence at turn 0 — assessing stances only.
 *
 * The base seat rule (#1445) narrows the pre-contact question to the SIGNAL's
 * scope: what a term meant, whether an adjacent candidate is in scope. Under
 * the checklist protocol that is too narrow, and the plan says so (§3: the
 * pre-contact consult is "the same rule at turn 0 — an unknown that is pivotal
 * before any contact and client-resolvable"). A dimension like the client's own
 * level, availability or budget is exactly that: unknown, pivotal, and theirs
 * alone to settle.
 *
 * The live failure it answers is an asymmetry, not a shortage. With the
 * responding seat no longer closing over an open dimension, it parks and asks
 * ITS principal on turn 1 — so the initiating side, which only ever holds turn
 * 0 before that, never reaches a turn on which it could ask its own client
 * anything. Both sides now get one chance at the same moment in the dialogue.
 *
 * What it keeps from #1445 is the test that makes a turn-0 question safe, and
 * restates it as a property of the ANSWER rather than of the wording: the
 * answer has to hold for the next candidate on this signal too. "What grade do
 * you climb" survives that test; "is this person good enough" does not, and it
 * is the second kind the base rule was written to prevent.
 *
 * Stance-scoped rather than seat-level because the base rule renders under
 * every stance, `advocate` included, and its wording is pinned byte-for-byte by
 * the golden prompt matrix.
 */
const CHECKLIST_PRE_CONTACT_RULE = ` Weigh the two moves by what they cost and what they can undo. Reaching out spends the counterparty's attention and {userName}'s name on a match you have not finished scoring, and it cannot be taken back; asking {userName} first is invisible to the counterparty, costs one sentence, and is the only moment in this negotiation where a question buys a better OPENING rather than a correction. So where a dimension is open and theirs to settle, asking now is not the timid option — it is the one that spends less. A checklist dimension that is unknown and {userName}'s own to settle — their level, their availability, their budget, what they are actually willing to commit to — is as good a reason to pause here as a question about the signal's wording. The test is not whether the question mentions this candidate: it is whether the ANSWER would still hold for the next candidate on this signal. Where it would, ask it now; where the answer would only be about this one person, it is yours to judge, not theirs.`;

/** The checklist pre-contact rule plus the not-worth-making lean. */
export const PRE_CONTACT_CONSULT_RULE = CHECKLIST_PRE_CONTACT_RULE + SKEPTIC_PRE_CONTACT_LEAN;

/**
 * The discovery-query satisfaction rule. Query satisfaction is
 * necessary-but-not-sufficient: a precondition for continuing to evaluate,
 * never itself a reason to connect.
 *
 * Names are interpolated eagerly here: this fragment is spliced into the system
 * prompt *after* the caller's global `{userName}` substitution has already run,
 * so a placeholder would survive into the rendered prompt.
 */
export function querySatisfiedRule(otherName: string, userName: string): string {
  return `- If ${otherName} DOES satisfy the query: satisfying the query is a PRECONDITION for continuing to evaluate, NOT a reason to connect. Keep evaluating fit on intents and profile data, and decline when the connection would not be worth ${userName}'s attention.`;
}
