import { z } from 'zod';

// -- Node Discovery --

export const WellKnownResponseSchema = z.object({
  version: z.string(),
  name: z.string(),
  baseUrl: z.string().url(),
  endpoints: z.object({
    users: z.string(),
    indexes: z.string(),
    inbox: z.string(),
  }),
  publicKey: z.object({
    id: z.string(),
    pem: z.string(),
  }),
});
export type WellKnownResponse = z.infer<typeof WellKnownResponseSchema>;

// -- Federated Entities --

export const FederatedUserSchema = z.object({
  id: z.string().url(),
  name: z.string(),
  avatar: z.string().url().nullable(),
  narrative: z.string().nullable(),
  attributes: z.record(z.unknown()).nullable(),
  nodeUrl: z.string().url(),
});
export type FederatedUser = z.infer<typeof FederatedUserSchema>;

export const FederatedIndexSchema = z.object({
  id: z.string().url(),
  title: z.string(),
  prompt: z.string().nullable(),
  permissions: z.record(z.unknown()).nullable(),
  memberCount: z.number().int(),
  nodeUrl: z.string().url(),
});
export type FederatedIndex = z.infer<typeof FederatedIndexSchema>;

export const FederatedIntentSchema = z.object({
  intentUrl: z.string().url(),
  payload: z.string(),
  embedding: z.array(z.number()),
  similarity: z.number().optional(),
  userId: z.string().url(),
});
export type FederatedIntent = z.infer<typeof FederatedIntentSchema>;

// -- Requests --

export const JoinIndexRequestSchema = z.object({
  actor: z.string().url(),
});
export type JoinIndexRequest = z.infer<typeof JoinIndexRequestSchema>;

export const PushIntentRequestSchema = z.object({
  actor: z.string().url(),
  payload: z.string(),
  embedding: z.array(z.number()),
  metadata: z.record(z.unknown()).default({}),
});
export type PushIntentRequest = z.infer<typeof PushIntentRequestSchema>;

export const UpdateIntentRequestSchema = z.object({
  actor: z.string().url(),
  payload: z.string().optional(),
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type UpdateIntentRequest = z.infer<typeof UpdateIntentRequestSchema>;

export const QueryIndexRequestSchema = z.object({
  embedding: z.array(z.number()),
  limit: z.number().int().min(1).max(200).default(50),
  filters: z.object({
    status: z.string().optional(),
  }).default({}),
});
export type QueryIndexRequest = z.infer<typeof QueryIndexRequestSchema>;

export const QueryIndexResponseSchema = z.object({
  results: z.array(FederatedIntentSchema),
});
export type QueryIndexResponse = z.infer<typeof QueryIndexResponseSchema>;

// -- Chat --

export const ChatMessageSchema = z.object({
  type: z.literal('ChatMessage'),
  from: z.string().url(),
  to: z.string().url(),
  sessionId: z.string().uuid(),
  content: z.string(),
  context: z.object({
    indexUrl: z.string().url().optional(),
    opportunityId: z.string().optional(),
  }).nullable(),
  timestamp: z.string().datetime(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
