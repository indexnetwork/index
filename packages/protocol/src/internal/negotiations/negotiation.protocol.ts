/**
 * Seat-scoped client-advocate negotiation protocol rules.
 *
 * v2 fixes exactly one initiating seat per match (`metadata.initiatorUserId`,
 * stamped at discovery time — IND-396) and makes consent asymmetric:
 * **accept can only come from the counterparty seat**, schema-enforced.
 *
 * Vocabulary per seat (v2):
 * - initiator:     `outreach | counter | question | withdraw`  (no accept)
 * - counterparty:  `accept | decline | counter | question`
 * - final turn:    initiator `withdraw | counter`; counterparty `accept | decline`
 *
 * Outcome mapping: `accept` → opportunity `pending`, `withdraw`/`decline` →
 * `rejected`, turn-cap → `stalled`.
 */
import { z } from "zod";

import { ChecklistDraftGenerationSchema } from "../../protocol/schemas/negotiation-checklist.schema.js";
import { AskUserGenerationSchema } from "../../protocol/schemas/negotiation-state.schema.js";
import { QUESTION_BUDGET_PER_PRINCIPAL } from "./negotiation.checklist.contracts.js";
import type { NegotiationAction, NegotiationSeat } from "../../protocol/schemas/negotiation-state.schema.js";
export { ASK_USER_LOCK_SLACK_MS, ASK_USER_WINDOW_MS, NEGOTIATION_MAX_TURNS_AMBIENT, NEGOTIATION_MAX_TURNS_CHAT } from "../../protocol/core.js";

// ─── Shared assessment fragment ──────────────────────────────────────────────

const AssessmentSchema = z.object({
  reasoning: z.string(),
  suggestedRoles: z.object({
    ownUser: z.enum(["agent", "patient", "peer"]),
    otherUser: z.enum(["agent", "patient", "peer"]),
  }),
});

function turnSchema<T extends [NegotiationAction, ...NegotiationAction[]]>(actions: T) {
  return z.object({
    action: z.enum(actions),
    assessment: AssessmentSchema,
    message: z.string().nullable().optional(),
  });
}

// ─── v2 seat-scoped turn schemas ─────────────────────────────────────────────

/** Initiator seat, non-final turn: may reach out, push back, ask, or walk away — never accept. */
export const InitiatorTurnSchema = turnSchema(["outreach", "counter", "question", "withdraw"]);

/** Counterparty seat, non-final turn: the only seat that can accept. */
export const CounterpartyTurnSchema = turnSchema(["accept", "decline", "counter", "question"]);

/** Initiator seat, final allowed turn: commit to walking away or leave the door open. */
export const FinalInitiatorTurnSchema = turnSchema(["withdraw", "counter"]);

/** Counterparty seat, final allowed turn: must decide. */
export const FinalCounterpartyTurnSchema = turnSchema(["accept", "decline"]);

// ─── v2 ask_user variants (P3.2) ───────────────────────────────────────────
// Non-final turns only: the final-cap turn must decide, never pause. Selected
// via the `opts.askUser` parameter on allowedActionsFor/turnSchemaFor — the
// base schemas above stay byte-identical for every existing caller.

/** Initiator seat, non-final turn, with the client-consult pause available. */
export const InitiatorAskUserTurnSchema = turnSchema(["outreach", "counter", "question", "withdraw", "ask_user"])
  .extend({ askUser: AskUserGenerationSchema.nullable().optional() });

/** Counterparty seat, non-final turn, with the client-consult pause available. */
export const CounterpartyAskUserTurnSchema = turnSchema(["accept", "decline", "counter", "question", "ask_user"])
  .extend({ askUser: AskUserGenerationSchema.nullable().optional() });

// ─── Action vocabulary per seat ──────────────────────────────────────────────
const V2_INITIATOR_ACTIONS: readonly NegotiationAction[] = ["outreach", "counter", "question", "withdraw"];
const V2_COUNTERPARTY_ACTIONS: readonly NegotiationAction[] = ["accept", "decline", "counter", "question"];
const V2_FINAL_INITIATOR_ACTIONS: readonly NegotiationAction[] = ["withdraw", "counter"];
const V2_FINAL_COUNTERPARTY_ACTIONS: readonly NegotiationAction[] = ["accept", "decline"];
const V2_INITIATOR_ASK_USER_ACTIONS: readonly NegotiationAction[] = [...V2_INITIATOR_ACTIONS, "ask_user"];
const V2_COUNTERPARTY_ASK_USER_ACTIONS: readonly NegotiationAction[] = [...V2_COUNTERPARTY_ACTIONS, "ask_user"];

/**
 * The set of actions a given seat may submit.
 */
export function allowedActionsFor(
  seat: NegotiationSeat,
  isFinalTurn = false,
  opts?: TurnVocabularyOpts,
): readonly NegotiationAction[] {
  if (seat === "initiator") {
    return isFinalTurn
      ? V2_FINAL_INITIATOR_ACTIONS
      : (opts?.askUser ? V2_INITIATOR_ASK_USER_ACTIONS : V2_INITIATOR_ACTIONS);
  }
  return isFinalTurn
    ? V2_FINAL_COUNTERPARTY_ACTIONS
    : (opts?.askUser ? V2_COUNTERPARTY_ASK_USER_ACTIONS : V2_COUNTERPARTY_ACTIONS);
}

/**
 * Zod turn schema for a system-agent turn, selected by seat + final-turn flag,
 * making an initiator `accept` structurally
 * impossible rather than prompt-discouraged.
 *
 */
export function turnSchemaFor(
  seat: NegotiationSeat,
  isFinalTurn: boolean,
  opts?: TurnVocabularyOpts,
): z.ZodTypeAny {
  const base = ((): z.ZodTypeAny => {
    if (seat === "initiator") {
      return isFinalTurn
        ? FinalInitiatorTurnSchema
        : (opts?.askUser ? InitiatorAskUserTurnSchema : InitiatorTurnSchema);
    }
    return isFinalTurn
      ? FinalCounterpartyTurnSchema
      : (opts?.askUser ? CounterpartyAskUserTurnSchema : CounterpartyTurnSchema);
  })();
  return opts?.checklist === true ? withChecklistField(base) : base;
}

/**
 * Add the checklist field to a turn schema.
 *
 * Gated at the callsite rather than baked into every schema, for the same
 * reason `ask_user` is: the generation schema must offer exactly what this
 * turn's prompt explains. A negotiator drafting under a stance with no
 * checklist protocol would otherwise be handed a field nothing told it how to
 * fill — and the `advocate` stance's byte-identical prompt is the invariant
 * that would break first. The permissive persistence schemas
 * (`negotiation.state.ts`, the shared DTO) carry the field unconditionally,
 * because they must read back turns that any seat may have written.
 *
 * The GENERATION variant of the draft schema, following #1466: `settles` is
 * required so the emitted JSON schema asks for it on every dimension, and
 * repairs to `either` when the model omits or garbles it rather than throwing
 * inside the structured-output call and taking the turn with it. The persisted
 * `ChecklistDraftSchema` keeps the field optional, because it has to read back
 * every turn written before the field existed.
 */
export function withChecklistField(schema: z.ZodTypeAny): z.ZodTypeAny {
  return schema instanceof z.ZodObject
    ? schema.extend({ checklist: ChecklistDraftGenerationSchema.nullable().optional() })
    : schema;
}

/**
 * Opt-in extensions of a turn's vocabulary, beyond the seat's own actions.
 *
 * `askUser` adds the client-consult pause (P3.2). Never granted on final-cap
 * turns (the final turn must decide). Callers pass
 * `{ askUser: true }` only when the full pause loop is available on their
 * surface: the ask-user feature flag is on, a questioner enqueue and an
 * answer-window timer are wired, the negotiation has an opportunity to resume
 * against, and the acting principal's question budget for this negotiation is
 * not yet spent.
 *
 * `checklist` adds the checklist field the turn scores. Passed only where the
 * prompt carries the checklist protocol, so the schema and the rules a turn
 * sees always describe the same move.
 */
export interface TurnVocabularyOpts {
  askUser?: boolean;
  checklist?: boolean;
}

/** @deprecated Use {@link TurnVocabularyOpts}. */
export type AskUserOpts = TurnVocabularyOpts;

// ─── Action semantics (version-independent) ──────────────────────────────────

/** Terminal actions end the negotiation immediately. */
export function isTerminalAction(action: string | undefined | null): boolean {
  return action === "accept" || action === "withdraw" || action === "decline";
}

/** Reject-like actions map the opportunity to `rejected`. */
export function isRejectLikeAction(action: string | undefined | null): boolean {
  return action === "withdraw" || action === "decline";
}

/**
 * Whether a negotiation has already made contact — whether anything of this
 * negotiation's own has been put in front of the counterparty.
 *
 * Contact is a PERSISTED TURN, nothing weaker: task metadata about a
 * negotiation is not something the counterparty ever saw.
 *
 * `ask_user` is the one persisted turn that is not contact. It parks the
 * negotiation to ask the client's OWN principal a question before deciding to
 * reach out; nothing was ever addressed to the counterparty. This is the same
 * reading `isPreContactConsultResume` already applies to an all-`ask_user`
 * history, and keeping the two in step is what lets a pre-contact consult
 * resume still resolve as the opening decision it is.
 *
 * Scope matters as much as the predicate: callers pass THIS negotiation's turns
 * (`readNegotiationMessages`), never the pair's whole DM. A new match reusing
 * an established `dm_pair` conversation has made no contact of its own.
 *
 * Two live rules depend on it, and both are claims about whether a message
 * exists: the IND-564 opening-`withdraw` guard (never retract an outreach that
 * was never made) and the `screened_out` label in finalize (an outcome that
 * asserts nothing was ever sent may not be stamped on a negotiation whose own
 * messages contradict it).
 */
export function negotiationHasMadeContact(
  turns: readonly { action: string }[],
): boolean {
  return turns.some((turn) => turn.action !== "ask_user");
}

/**
 * Conservative action when an agent produced schema-invalid output (after the
 * retry) or an internal error needs a seat-valid terminal placeholder.
 *
 * Non-final turns fall back to `counter` (keeps the dialogue open — the AC's
 * "conservative counter"). Final turns must decide: the counterparty →
 * `decline`, the initiator → `counter` is still legal on the
 * final turn so it stays `counter` (finalizes as turn-cap/stalled).
 */
export function fallbackActionFor(
  seat: NegotiationSeat,
  isFinalTurn: boolean,
): NegotiationAction {
  if (!isFinalTurn) return "counter";
  return seat === "counterparty" ? "decline" : "counter";
}

/** Seat-appropriate reject-like action for error paths. */
export function rejectActionFor(
  seat: NegotiationSeat,
): NegotiationAction {
  return seat === "initiator" ? "withdraw" : "decline";
}

/**
 * Default per-negotiation ask cap: total client-consultation rounds (mid-flight
 * `ask_user` pauses and post-stall parks, both sides combined) before the
 * negotiation stalls terminally instead of parking again. Three admits one
 * post-stall park even after each side has spent its one mid-flight consult.
 */
export const DEFAULT_NEGOTIATION_ASK_ROUNDS_CAP = 3;

/**
 * The same cap under the checklist protocol, where the BINDING bound is
 * per principal (`QUESTION_BUDGET_PER_PRINCIPAL` — the turn-0 pre-contact
 * consult included) and this is only the negotiation-wide backstop above it:
 * both principals' full budgets, plus one post-stall park.
 *
 * Derived rather than chosen, and separate from the default rather than
 * replacing it: at 3 the combined cap would bind before either principal's own
 * budget — starving the very thing the plan's budget exists to grant — while
 * raising it for the pre-checklist stance would loosen a bound nothing else in
 * that stance changed.
 */
export const CHECKLIST_NEGOTIATION_ASK_ROUNDS_CAP = 2 * QUESTION_BUDGET_PER_PRINCIPAL + 1;

/**
 * Per-negotiation ask cap. The cap exists so two agents cannot ping-pong their
 * humans indefinitely; which bound applies depends only on the protocol.
 */
export function negotiationAskRoundsCap(opts?: { checklist?: boolean }): number {
  return opts?.checklist === true
    ? CHECKLIST_NEGOTIATION_ASK_ROUNDS_CAP
    : DEFAULT_NEGOTIATION_ASK_ROUNDS_CAP;
}

/**
 * Resolve the seat of `userId` on a negotiation task.
 *
 * Keys on `metadata.initiatorUserId` (the rigid v2 stamp), **never on turn
 * parity** — continuations can start with either side speaking first, so
 * parity misattributes seats across sessions. Pre-stamp tasks fall back to
 * `sourceUserId` (the discovery-session opener), which is what the stamp
 * defaults to anyway.
 */
export function resolveSeat(
  userId: string,
  metadata: { initiatorUserId?: unknown; sourceUserId?: unknown } | null | undefined,
): NegotiationSeat {
  const initiator =
    typeof metadata?.initiatorUserId === "string" && metadata.initiatorUserId.length > 0
      ? metadata.initiatorUserId
      : typeof metadata?.sourceUserId === "string"
        ? metadata.sourceUserId
        : undefined;
  return initiator === userId ? "initiator" : "counterparty";
}

/** Human-readable seat-violation message shared by respond surfaces. */
export function seatViolationMessage(
  action: string,
  seat: NegotiationSeat,
): string {
  const allowed = allowedActionsFor(seat).join(", ");
  return `Action "${action}" is not allowed for your seat (${seat}). Allowed actions: ${allowed}.`;
}
