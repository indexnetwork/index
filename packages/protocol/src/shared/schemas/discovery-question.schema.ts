/**
 * DiscoveryQuestionInput and nested types.
 * Leaf types have full Zod schemas. The composite DiscoveryQuestionInput is
 * a pure interface referencing cross-schema types (DiscoveryNegotiationDigest,
 * ChatContextDigest) to avoid Zod cross-schema runtime coupling.
 */
import { z } from "zod";
import type { DiscoveryNegotiationDigest } from "./negotiation-digest.schema.js";
import type { ChatContextDigest } from "./chat-context.schema.js";

// ─── Primitives ───────────────────────────────────────────────────────────────

export const NegotiationRoleSchema = z.enum(["agent", "patient", "peer"]);
export type NegotiationRole = z.infer<typeof NegotiationRoleSchema>;

export const DiscoveryTurnSchema = z.object({
  action: z.enum(["propose", "accept", "reject", "counter", "question"]),
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
  reason: z.enum(["turn_cap", "timeout"]).optional(),
});
export type DiscoveryOutcome = z.infer<typeof DiscoveryOutcomeSchema>;

export const DiscoveryNegotiationSchema = z.object({
  counterpartyId: z.string(),
  counterpartyHint: z.string(),
  indexContext: z.string(),
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

// ─── Composite input (pure interface — references cross-schema types) ─────────

/**
 * Full input to the question generator.
 * Defined as a pure interface so it can reference DiscoveryNegotiationDigest
 * and ChatContextDigest from sibling schemas without Zod runtime coupling.
 */
export interface DiscoveryQuestionInput {
  query: string;
  sourceProfile: DiscoverySourceProfile;
  negotiationDigests: DiscoveryNegotiationDigest[];
  summary: DiscoverySummary;
  chatContext?: ChatContextDigest;
  now: string;
}