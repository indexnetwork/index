/**
 * Seat-scoped negotiation protocol rules (v2 client-advocate protocol).
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
 * v1 tasks keep the legacy vocabulary (`propose | accept | reject | counter |
 * question`) — the version is inherited per conversation, never re-stamped, so
 * in-flight v1 negotiations are grandfathered untouched.
 *
 * Outcome mapping is version-independent: `accept` → opportunity `pending`,
 * `reject`/`withdraw`/`decline` → `rejected`, turn-cap → `stalled`.
 */
import { z } from "zod";

import { AskUserGenerationSchema } from "../shared/schemas/negotiation-state.schema.js";
import { ChecklistDraftGenerationSchema } from "../shared/schemas/negotiation-checklist.schema.js";
import { QUESTION_BUDGET_PER_PRINCIPAL } from "./negotiation.checklist.contracts.js";
import type { NegotiationAction, NegotiationSeat, NegotiationProtocolVersion } from "../shared/schemas/negotiation-state.schema.js";

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
    /**
     * Present when action is `ask_user` (v2, P3.2).
     *
     * The GENERATION payload, not the persisted one: these schemas are what a
     * model drafts into, and `guaranteed` — the conclusion floor's own mark —
     * must not be a field it can see. See `AskUserGenerationSchema`.
     */
    askUser: AskUserGenerationSchema.nullable().optional(),
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

// ─── v2 ask_user variants (P3.2, flag-gated) ────────────────────────────────
// Non-final turns only: the final-cap turn must decide, never pause. Selected
// via the `opts.askUser` parameter on allowedActionsFor/turnSchemaFor — the
// base schemas above stay byte-identical for every existing caller.

/** Initiator seat, non-final turn, with the client-consult pause available. */
export const InitiatorAskUserTurnSchema = turnSchema(["outreach", "counter", "question", "withdraw", "ask_user"]);

/** Counterparty seat, non-final turn, with the client-consult pause available. */
export const CounterpartyAskUserTurnSchema = turnSchema(["accept", "decline", "counter", "question", "ask_user"]);

// ─── Action vocabulary per version + seat ────────────────────────────────────

const V1_ACTIONS: readonly NegotiationAction[] = ["propose", "accept", "reject", "counter", "question"];
const V1_FINAL_ACTIONS: readonly NegotiationAction[] = ["accept", "reject"];
const V2_INITIATOR_ACTIONS: readonly NegotiationAction[] = ["outreach", "counter", "question", "withdraw"];
const V2_COUNTERPARTY_ACTIONS: readonly NegotiationAction[] = ["accept", "decline", "counter", "question"];
const V2_FINAL_INITIATOR_ACTIONS: readonly NegotiationAction[] = ["withdraw", "counter"];
const V2_FINAL_COUNTERPARTY_ACTIONS: readonly NegotiationAction[] = ["accept", "decline"];
const V2_INITIATOR_ASK_USER_ACTIONS: readonly NegotiationAction[] = [...V2_INITIATOR_ACTIONS, "ask_user"];
const V2_COUNTERPARTY_ASK_USER_ACTIONS: readonly NegotiationAction[] = [...V2_COUNTERPARTY_ACTIONS, "ask_user"];

/**
 * The set of actions a given seat may submit under a given protocol version.
 *
 * v1 ignores the seat entirely (legacy symmetric vocabulary) so pre-v2
 * negotiations behave exactly as before.
 */
export function allowedActionsFor(
  version: NegotiationProtocolVersion,
  seat: NegotiationSeat,
  isFinalTurn = false,
  opts?: TurnVocabularyOpts,
): readonly NegotiationAction[] {
  if (version !== "v2") return isFinalTurn ? V1_FINAL_ACTIONS : V1_ACTIONS;
  const askUser = opts?.askUser === true && !isFinalTurn;
  if (seat === "initiator") {
    return isFinalTurn ? V2_FINAL_INITIATOR_ACTIONS : (askUser ? V2_INITIATOR_ASK_USER_ACTIONS : V2_INITIATOR_ACTIONS);
  }
  return isFinalTurn ? V2_FINAL_COUNTERPARTY_ACTIONS : (askUser ? V2_COUNTERPARTY_ASK_USER_ACTIONS : V2_COUNTERPARTY_ACTIONS);
}

/**
 * Zod turn schema for a system-agent turn, selected by version + seat +
 * final-turn flag. v1 returns the legacy schemas (seat-agnostic); v2 returns
 * the seat-scoped schemas above, making an initiator `accept` structurally
 * impossible rather than prompt-discouraged.
 *
 * The v1 legacy schemas are passed in by the caller (they live in
 * `negotiation.state.ts`) to keep this module free of a state-module import.
 */
export function turnSchemaFor(
  version: NegotiationProtocolVersion,
  seat: NegotiationSeat,
  isFinalTurn: boolean,
  v1Schemas: { system: z.ZodTypeAny; final: z.ZodTypeAny },
  opts?: TurnVocabularyOpts,
): z.ZodTypeAny {
  const base = ((): z.ZodTypeAny => {
    if (version !== "v2") return isFinalTurn ? v1Schemas.final : v1Schemas.system;
    const askUser = opts?.askUser === true && !isFinalTurn;
    if (seat === "initiator") {
      return isFinalTurn ? FinalInitiatorTurnSchema : (askUser ? InitiatorAskUserTurnSchema : InitiatorTurnSchema);
    }
    return isFinalTurn ? FinalCounterpartyTurnSchema : (askUser ? CounterpartyAskUserTurnSchema : CounterpartyTurnSchema);
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
 * Non-object schemas pass through untouched: the v1 schemas arrive as
 * `z.ZodTypeAny` from the caller, so this must degrade rather than throw if
 * one is ever wrapped.
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
 * turns (the final turn must decide) and never under v1. Callers pass
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
  return action === "accept" || action === "reject" || action === "withdraw" || action === "decline";
}

/** Reject-like actions map the opportunity to `rejected` (v1 reject, v2 withdraw/decline). */
export function isRejectLikeAction(action: string | undefined | null): boolean {
  return action === "reject" || action === "withdraw" || action === "decline";
}

/**
 * Conservative action when an agent produced schema-invalid output (after the
 * retry) or an internal error needs a seat-valid terminal placeholder.
 *
 * Non-final turns fall back to `counter` (keeps the dialogue open — the AC's
 * "conservative counter"). Final turns must decide: v1 → `reject`, v2
 * counterparty → `decline`, v2 initiator → `counter` is still legal on the
 * final turn so it stays `counter` (finalizes as turn-cap/stalled).
 */
export function fallbackActionFor(
  version: NegotiationProtocolVersion,
  seat: NegotiationSeat,
  isFinalTurn: boolean,
): NegotiationAction {
  if (!isFinalTurn) return "counter";
  if (version !== "v2") return "reject";
  return seat === "counterparty" ? "decline" : "counter";
}

/** Seat-appropriate reject-like action for error paths. */
export function rejectActionFor(
  version: NegotiationProtocolVersion,
  seat: NegotiationSeat,
): NegotiationAction {
  if (version !== "v2") return "reject";
  return seat === "initiator" ? "withdraw" : "decline";
}

// ─── Metadata readers ────────────────────────────────────────────────────────

/**
 * Read the protocol version off task metadata. Returns null when the task
 * predates version stamping (treat as v1 at the call site when the task is a
 * genuine prior; fresh tasks stamp from {@link configuredProtocolVersion}).
 */
export function readProtocolVersion(
  metadata: { protocolVersion?: unknown } | null | undefined,
): NegotiationProtocolVersion | null {
  const v = metadata?.protocolVersion;
  return v === "v2" ? "v2" : v === "v1" ? "v1" : null;
}

/**
 * Protocol version for negotiations without a prior task for the same
 * opportunity, from the `NEGOTIATION_PROTOCOL_VERSION` env switch. Defaults
 * to `v1` when unset — v2 is opt-in per environment, and rolling back is the
 * same single switch (only in-flight negotiations stay pinned to their
 * stamped version).
 */
export function configuredProtocolVersion(): NegotiationProtocolVersion {
  return process.env.NEGOTIATION_PROTOCOL_VERSION === "v2" ? "v2" : "v1";
}

/**
 * Whether the `ask_user` client-consult pause (P3.2) is enabled, from the
 * `NEGOTIATION_ASK_USER_ENABLED` env switch. Defaults to off — the deployment
 * is byte-for-byte unchanged until the flag is flipped, and rolling back is
 * the same single switch.
 */
export function configuredAskUserEnabled(): boolean {
  return process.env.NEGOTIATION_ASK_USER_ENABLED === "true";
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
 * Per-negotiation ask cap, overridable via `NEGOTIATION_ASK_ROUNDS_CAP`.
 * Invalid or non-positive values fall back to the protocol-appropriate default
 * — zero is not an off switch here; the cap exists so two agents cannot
 * ping-pong their humans indefinitely. It tunes the bound, it does not gate the
 * behaviour.
 *
 * An explicit override wins under either protocol: it is an operator statement
 * about this deployment, and silently raising it for one stance would make the
 * knob mean two things.
 */
export function negotiationAskRoundsCap(opts?: { checklist?: boolean }): number {
  const raw = process.env.NEGOTIATION_ASK_ROUNDS_CAP;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return opts?.checklist === true
    ? CHECKLIST_NEGOTIATION_ASK_ROUNDS_CAP
    : DEFAULT_NEGOTIATION_ASK_ROUNDS_CAP;
}

/** Default answer window for a paused `ask_user` negotiation: 24 hours. */
export const DEFAULT_ASK_USER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Answer window for a paused `ask_user` negotiation, in ms. Overridable via
 * `NEGOTIATION_ASK_USER_WINDOW_MS` (dev/e2e use shorter windows to exercise
 * the expiry path); invalid or non-positive values fall back to 24 h.
 */
export function askUserAnswerWindowMs(): number {
  const raw = process.env.NEGOTIATION_ASK_USER_WINDOW_MS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_ASK_USER_WINDOW_MS;
}

/**
 * Slack added on top of the answer window when deciding whether a paused
 * (`input_required`) task still holds the conversation lock. Covers expiry
 * worker delay: the lock must outlive the timer slightly, so ambient
 * rediscovery cannot slip in between window expiry and the worker's resume.
 */
export const ASK_USER_LOCK_SLACK_MS = 60 * 60 * 1000;

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
  version: NegotiationProtocolVersion,
): string {
  const allowed = allowedActionsFor(version, seat).join(", ");
  return `Action "${action}" is not allowed for your seat (${seat}) under negotiation protocol ${version}. Allowed actions: ${allowed}.`;
}
