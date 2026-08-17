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

import { AskUserPayloadSchema } from "../shared/schemas/negotiation-state.schema.js";
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
    /** Present when action is `ask_user` (v2, P3.2). */
    askUser: AskUserPayloadSchema.nullable().optional(),
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
  opts?: AskUserOpts,
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
  opts?: AskUserOpts,
): z.ZodTypeAny {
  if (version !== "v2") return isFinalTurn ? v1Schemas.final : v1Schemas.system;
  const askUser = opts?.askUser === true && !isFinalTurn;
  if (seat === "initiator") {
    return isFinalTurn ? FinalInitiatorTurnSchema : (askUser ? InitiatorAskUserTurnSchema : InitiatorTurnSchema);
  }
  return isFinalTurn ? FinalCounterpartyTurnSchema : (askUser ? CounterpartyAskUserTurnSchema : CounterpartyTurnSchema);
}

/**
 * Opt-in extension of the seat vocabulary with the `ask_user` client-consult
 * pause (P3.2). Never granted on final-cap turns (the final turn must decide)
 * and never under v1. Callers pass `{ askUser: true }` only when the full
 * pause loop is available on their surface: the ask-user feature flag is on,
 * a questioner enqueue and an answer-window timer are wired, the negotiation
 * has an opportunity to resume against, and the acting side has not already
 * consumed its one client question for this negotiation (rationing).
 */
export interface AskUserOpts {
  askUser?: boolean;
}

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
