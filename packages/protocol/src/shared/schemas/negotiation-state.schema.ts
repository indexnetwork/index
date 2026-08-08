/**
 * Negotiation state DTOs extracted from negotiation/negotiation.state.ts for
 * consumption by shared interfaces. This shared module owns the DTO schemas;
 * LangGraph Annotation.Root stays in the domain file.
 */
import { z } from "zod";

// ─── Zod schemas (available for runtime validation) ───────────────────────────

/**
 * Union of every negotiation turn action across protocol versions.
 *
 * v1 vocabulary: `propose | accept | reject | counter | question`.
 * v2 (client-advocate seat rules) renames `propose`→`outreach` and splits
 * `reject` into `withdraw` (initiator seat) / `decline` (counterparty seat).
 * Which subset is valid for a given turn depends on the task's
 * `protocolVersion` and the acting user's seat — see
 * `negotiation/negotiation.protocol.ts` for the seat-scoped schemas.
 */
export const NEGOTIATION_ACTIONS = [
  "propose", "accept", "reject", "counter", "question",
  "outreach", "withdraw", "decline",
  "ask_user",
] as const;
export type NegotiationAction = (typeof NEGOTIATION_ACTIONS)[number];

/** Negotiation seat under the v2 client-advocate protocol. */
export type NegotiationSeat = "initiator" | "counterparty";

/** Negotiation protocol version stamped on task metadata. */
export type NegotiationProtocolVersion = "v1" | "v2";

/** Closed, content-free reasons that select server-owned consultation copy. */
export const NEGOTIATION_CONSULTATION_REASONS = [
  "unresolved_owner_constraint",
  "consequential_disclosure_permission",
  "repeated_non_convergence",
  "insufficient_commitment_authority",
] as const;
export const NegotiationConsultationReasonSchema = z.enum(NEGOTIATION_CONSULTATION_REASONS);
export type NegotiationConsultationReason = z.infer<typeof NegotiationConsultationReasonSchema>;

/**
 * Payload for a v2 `ask_user` action. Agents may choose only a closed reason;
 * disclosure subjects and question wording are always rendered by fixed
 * server templates and can never carry model-authored instructions.
 */
export const AskUserPayloadSchema = z.object({
  reason: NegotiationConsultationReasonSchema,
}).strict();
export type AskUserPayload = z.infer<typeof AskUserPayloadSchema>;

export const NegotiationTurnSchema = z.object({
  action: z.enum(NEGOTIATION_ACTIONS),
  assessment: z.object({
    reasoning: z.string(),
    suggestedRoles: z.object({
      ownUser: z.enum(["agent", "patient", "peer"]),
      otherUser: z.enum(["agent", "patient", "peer"]),
    }),
  }),
  message: z.string().nullable().optional(),
  /** Present when action is `ask_user` (v2, P3.2). */
  askUser: AskUserPayloadSchema.nullable().optional(),
});
export type NegotiationTurn = z.infer<typeof NegotiationTurnSchema>;

export const NegotiationOutcomeSchema = z.object({
  hasOpportunity: z.boolean(),
  agreedRoles: z.array(z.object({
    userId: z.string(),
    role: z.enum(["agent", "patient", "peer"]),
  })),
  reasoning: z.string(),
  turnCount: z.number(),
  reason: z.enum(["turn_cap", "timeout", "screened_out"]).optional(),
});
export type NegotiationOutcome = z.infer<typeof NegotiationOutcomeSchema>;

// ─── Pure interfaces ──────────────────────────────────────────────────────────

/** Context each agent receives about its user. */
export interface UserNegotiationContext {
  id: string;
  intents: Array<{ id: string; title: string; description: string; confidence: number }>;
  profile: { name?: string; bio?: string; location?: string; interests?: string[]; skills?: string[] };
}

/** Seed assessment from the evaluator pre-filter. */
export interface SeedAssessment {
  reasoning: string;
  valencyRole: string;
  actors?: Array<{ userId: string; role: string }>;
}