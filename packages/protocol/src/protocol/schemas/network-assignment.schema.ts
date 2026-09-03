/**
 * Shared assignment and opportunity-evidence DTOs.
 *
 * These schemas are graph-agnostic protocol contracts. Protocol graphs and
 * backend workers may use the inferred TypeScript types, while backend storage
 * remains responsible for schema/SQL details.
 */
import { z } from "zod";

export const NetworkAssignmentResourceTypeSchema = z.enum(["intent"]);
export type NetworkAssignmentResourceType = z.infer<typeof NetworkAssignmentResourceTypeSchema>;

export const NetworkAssignmentModeSchema = z.enum(["automatic", "manual_override"]);
export type NetworkAssignmentMode = z.infer<typeof NetworkAssignmentModeSchema>;

export const NetworkAssignmentScopeSchema = z.enum(["global", "network"]);
export type NetworkAssignmentScope = z.infer<typeof NetworkAssignmentScopeSchema>;

export const NetworkAssignmentPromptPresenceSchema = z.enum(["none", "index", "member", "both"]);
export type NetworkAssignmentPromptPresence = z.infer<typeof NetworkAssignmentPromptPresenceSchema>;

export const NetworkAssignmentPolicySchema = z.enum(["unified-threshold-v1"]);
export type NetworkAssignmentPolicy = z.infer<typeof NetworkAssignmentPolicySchema>;

export const NetworkAssignmentRawScoresSchema = z.object({
  indexScore: z.number().min(0).max(1).optional(),
  memberScore: z.number().min(0).max(1).optional(),
});
export type NetworkAssignmentRawScores = z.infer<typeof NetworkAssignmentRawScoresSchema>;

export const NetworkAssignmentMetadataSchema = z.object({
  resourceType: NetworkAssignmentResourceTypeSchema,
  mode: NetworkAssignmentModeSchema,
  scope: NetworkAssignmentScopeSchema,
  policy: NetworkAssignmentPolicySchema,
  threshold: z.number().min(0).max(1),
  promptPresence: NetworkAssignmentPromptPresenceSchema,
  rawScores: NetworkAssignmentRawScoresSchema.optional(),
  finalScore: z.number().min(0).max(1),
  assigned: z.boolean(),
  reason: z.string().optional(),
  evaluator: z.string().optional(),
  source: z.string().optional(),
  createdAt: z.string().datetime().optional(),
});
export type NetworkAssignmentMetadata = z.infer<typeof NetworkAssignmentMetadataSchema>;

export const OpportunityEvidenceKindSchema = z.enum([
  "query_intent",
  "query_context",
  "profile",
]);
export type OpportunityEvidenceKind = z.infer<typeof OpportunityEvidenceKindSchema>;

export const OpportunityEvidenceSchema = z.object({
  kind: OpportunityEvidenceKindSchema,
  networkId: z.string(),
  score: z.number().min(0).max(1).optional(),
  lens: z.string().optional(),
  discoverySource: z.literal("query").optional(),
  matchedStrategies: z.array(z.string()).optional(),
  candidateIntentId: z.string().optional(),
  sourceContextId: z.string().optional(),
  candidateContextId: z.string().optional(),
  payload: z.string().optional(),
  summary: z.string().optional(),
});
export type OpportunityEvidence = z.infer<typeof OpportunityEvidenceSchema>;
