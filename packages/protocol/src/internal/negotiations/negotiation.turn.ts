/**
 * Negotiation turn vocabulary (rewrite, #1494).
 *
 * A turn is one of two shapes: it continues the dialogue (`outreach | counter
 * | question`, with a message) or it pauses it (`pause`, with a reason and,
 * for two of the three reasons, a payload). There is no accept, decline or
 * withdraw on this surface — a side that wants out pauses
 * `ready_for_verdict(reject)` and lets its own IS-A act on it. `outreach` is
 * only legal as the negotiation's opening turn.
 */
import { z } from "zod";

export const NEGOTIATION_CONTINUE_VERBS = ["outreach", "counter", "question"] as const;
export type NegotiationContinueVerb = (typeof NEGOTIATION_CONTINUE_VERBS)[number];

export const NEGOTIATION_PAUSE_REASONS = ["counterparty_silent", "needs_principal", "ready_for_verdict"] as const;
export type NegotiationPauseReason = (typeof NEGOTIATION_PAUSE_REASONS)[number];

export const NegotiationVerdictSchema = z.enum(["pending", "reject"]);
export type NegotiationVerdict = z.infer<typeof NegotiationVerdictSchema>;

/** A continuing turn: reach out, push back, or ask the counterparty something. */
export const NegotiationContinueTurnSchema = z.object({
  verb: z.enum(NEGOTIATION_CONTINUE_VERBS),
  message: z.string().min(1),
  reasoning: z.string().min(1),
});
export type NegotiationContinueTurn = z.infer<typeof NegotiationContinueTurnSchema>;

/** The other side has not answered within the window. System-emitted only. */
export const NegotiationCounterpartySilentPauseSchema = z.object({
  verb: z.literal("pause"),
  reason: z.literal("counterparty_silent"),
});

/** Cannot continue without something only the principal knows. */
export const NegotiationNeedsPrincipalPauseSchema = z.object({
  verb: z.literal("pause"),
  reason: z.literal("needs_principal"),
  payload: z.object({ question: z.string().min(1) }),
});
export type NegotiationNeedsPrincipalPayload = z.infer<typeof NegotiationNeedsPrincipalPauseSchema>["payload"];

/** Believes a decision is possible; recommends one to its own IS-A. */
export const NegotiationReadyForVerdictPauseSchema = z.object({
  verb: z.literal("pause"),
  reason: z.literal("ready_for_verdict"),
  payload: z.object({
    recommendation: NegotiationVerdictSchema,
    reasoning: z.string().min(1),
  }),
});
export type NegotiationReadyForVerdictPayload = z.infer<typeof NegotiationReadyForVerdictPauseSchema>["payload"];

/**
 * Storage-facing pause shapes: `payload` is optional here, unlike the
 * authoring schemas above. `apply` never persists the real payload into the
 * shared thread — it's private to `pausedBy`, stored only in
 * `task.metadata.pause` — so what lands in a message, and what
 * `turnsFromMessages` parses back out of history, is a redacted
 * `{ verb: 'pause', reason }` marker. If these required `payload` the
 * marker would fail to parse and silently vanish from history, which is
 * worse than the leak this schema exists to prevent: `nextSpeaker` reads
 * the last turn to decide whether to retry the same speaker, and a dropped
 * pause breaks that read.
 */
const NegotiationNeedsPrincipalStoredPauseSchema = NegotiationNeedsPrincipalPauseSchema.extend({
  payload: NegotiationNeedsPrincipalPauseSchema.shape.payload.optional(),
});
const NegotiationReadyForVerdictStoredPauseSchema = NegotiationReadyForVerdictPauseSchema.extend({
  payload: NegotiationReadyForVerdictPauseSchema.shape.payload.optional(),
});

export const NegotiationPauseTurnSchema = z.discriminatedUnion("reason", [
  NegotiationCounterpartySilentPauseSchema,
  NegotiationNeedsPrincipalStoredPauseSchema,
  NegotiationReadyForVerdictStoredPauseSchema,
]);
export type NegotiationPauseTurn = z.infer<typeof NegotiationPauseTurnSchema>;

/** Every shape a persisted turn may take. */
export const NegotiationTurnSchema = z.union([NegotiationContinueTurnSchema, NegotiationPauseTurnSchema]);
export type NegotiationTurn = z.infer<typeof NegotiationTurnSchema>;

/** What an author (internal or external) may produce for its own side — never `counterparty_silent`, which is system-only. */
export const NegotiationAuthoredTurnSchema = z.union([
  NegotiationContinueTurnSchema,
  NegotiationNeedsPrincipalPauseSchema,
  NegotiationReadyForVerdictPauseSchema,
]);
export type NegotiationAuthoredTurn = z.infer<typeof NegotiationAuthoredTurnSchema>;

/** What the opening turn of a negotiation must be. */
export const NegotiationOpeningTurnSchema = z.object({
  verb: z.literal("outreach"),
  message: z.string().min(1),
  reasoning: z.string().min(1),
});

export function isPauseTurn(turn: NegotiationTurn): turn is NegotiationPauseTurn {
  return (turn as { verb?: string }).verb === "pause";
}

export function isContinueTurn(turn: NegotiationTurn): turn is NegotiationContinueTurn {
  return !isPauseTurn(turn);
}
