/**
 * Discovery negotiation summary types shared by the opportunity graph and its
 * negotiation-summary builder. Leaf types carry full Zod schemas.
 */
import { z } from "zod";

// ─── Primitives ───────────────────────────────────────────────────────────────

export const NegotiationRoleSchema = z.enum(["agent", "patient", "peer"]);
export type NegotiationRole = z.infer<typeof NegotiationRoleSchema>;

export const DiscoveryTurnSchema = z.object({
  action: z.enum(["counter", "question", "outreach"]),
  reasoning: z.string(),
  suggestedRoles: z.object({
    ownUser: NegotiationRoleSchema,
    otherUser: NegotiationRoleSchema,
  }),
});
export type DiscoveryTurn = z.infer<typeof DiscoveryTurnSchema>;

export const DiscoveryOutcomeSchema = z.object({
  hasOpportunity: z.boolean(),
  reasoning: z.string(),
  agreedRoles: z.array(z.object({
    userId: z.string(),
    role: NegotiationRoleSchema,
  })).optional(),
  reason: z.enum(["turn_cap", "timeout", "screened_out"]).optional(),
});
export type DiscoveryOutcome = z.infer<typeof DiscoveryOutcomeSchema>;

export const DiscoveryNegotiationSchema = z.object({
  counterpartyId: z.string(),
  counterpartyHint: z.string(),
  networkContext: z.string(),
  turns: z.array(DiscoveryTurnSchema),
  outcome: DiscoveryOutcomeSchema,
  seedAssessmentScore: z.number().optional(),
});
export type DiscoveryNegotiation = z.infer<typeof DiscoveryNegotiationSchema>;

export const DiscoverySummarySchema = z.object({
  totalCandidates: z.number(),
  opportunitiesFound: z.number(),
  noOpportunityCount: z.number(),
  timeoutCount: z.number(),
  roleDistribution: z.record(NegotiationRoleSchema, z.number()),
});
export type DiscoverySummary = {
  totalCandidates: number;
  opportunitiesFound: number;
  noOpportunityCount: number;
  timeoutCount: number;
  roleDistribution: Partial<Record<NegotiationRole, number>>;
};

export const DiscoverySourceProfileSchema = z.object({
  name: z.string().optional(),
  bio: z.string().optional(),
  location: z.string().optional(),
  skills: z.array(z.string()).optional(),
  interests: z.array(z.string()).optional(),
});
export type DiscoverySourceProfile = z.infer<typeof DiscoverySourceProfileSchema>;
