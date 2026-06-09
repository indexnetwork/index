/**
 * Negotiation state DTOs extracted from negotiation/negotiation.state.ts for
 * consumption by shared interfaces. This shared module owns the DTO schemas;
 * LangGraph Annotation.Root stays in the domain file.
 */
import { z } from "zod";

// ─── Zod schemas (available for runtime validation) ───────────────────────────

export const NegotiationTurnSchema = z.object({
  action: z.enum(["propose", "accept", "reject", "counter", "question"]),
  assessment: z.object({
    reasoning: z.string(),
    suggestedRoles: z.object({
      ownUser: z.enum(["agent", "patient", "peer"]),
      otherUser: z.enum(["agent", "patient", "peer"]),
    }),
  }),
  message: z.string().nullable().optional(),
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
  reason: z.enum(["turn_cap", "timeout"]).optional(),
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