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

// ─── Action vocabulary per version + seat ────────────────────────────────────

const V1_ACTIONS: readonly NegotiationAction[] = ["propose", "accept", "reject", "counter", "question"];
const V1_FINAL_ACTIONS: readonly NegotiationAction[] = ["accept", "reject"];
const V2_INITIATOR_ACTIONS: readonly NegotiationAction[] = ["outreach", "counter", "question", "withdraw"];
const V2_COUNTERPARTY_ACTIONS: readonly NegotiationAction[] = ["accept", "decline", "counter", "question"];
const V2_FINAL_INITIATOR_ACTIONS: readonly NegotiationAction[] = ["withdraw", "counter"];
const V2_FINAL_COUNTERPARTY_ACTIONS: readonly NegotiationAction[] = ["accept", "decline"];

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
): readonly NegotiationAction[] {
  if (version !== "v2") return isFinalTurn ? V1_FINAL_ACTIONS : V1_ACTIONS;
  if (seat === "initiator") return isFinalTurn ? V2_FINAL_INITIATOR_ACTIONS : V2_INITIATOR_ACTIONS;
  return isFinalTurn ? V2_FINAL_COUNTERPARTY_ACTIONS : V2_COUNTERPARTY_ACTIONS;
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
): z.ZodTypeAny {
  if (version !== "v2") return isFinalTurn ? v1Schemas.final : v1Schemas.system;
  if (seat === "initiator") return isFinalTurn ? FinalInitiatorTurnSchema : InitiatorTurnSchema;
  return isFinalTurn ? FinalCounterpartyTurnSchema : CounterpartyTurnSchema;
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
 * Protocol version for genuinely fresh negotiations, from the
 * `NEGOTIATION_PROTOCOL_VERSION` env switch. Defaults to `v1` when unset —
 * v2 is opt-in per environment, and rolling back is the same single switch.
 */
export function configuredProtocolVersion(): NegotiationProtocolVersion {
  return process.env.NEGOTIATION_PROTOCOL_VERSION === "v2" ? "v2" : "v1";
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
  version: NegotiationProtocolVersion,
): string {
  const allowed = allowedActionsFor(version, seat).join(", ");
  return `Action "${action}" is not allowed for your seat (${seat}) under negotiation protocol ${version}. Allowed actions: ${allowed}.`;
}
