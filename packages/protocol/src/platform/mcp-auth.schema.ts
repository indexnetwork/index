import { z } from 'zod';

/**
 * Transport-neutral auth input extracted at the HTTP boundary.
 */
export const McpAuthInputSchema = z.object({
  bearerToken: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  telegramHandle: z.string().min(1).optional(),
  telegramUsername: z.string().min(1).optional(),
}).strict();

export type McpAuthInput = z.infer<typeof McpAuthInputSchema>;

/**
 * Trusted API-key metadata used by the host auth composition.
 *
 * Enrollment and delivery flags are explicit opt-ins. Unknown metadata is
 * ignored so unrelated Better Auth metadata remains forward-compatible.
 */
export const McpApiKeyMetadataSchema = z.object({
  agentId: z.string().min(1).optional(),
  enrollmentCapable: z.boolean().optional(),
  isDeliveryAgent: z.boolean().optional(),
}).passthrough();

export type McpApiKeyMetadata = z.infer<typeof McpApiKeyMetadataSchema>;

/**
 * Protocol-owned result boundary for host authentication.
 */
export const McpResolvedIdentitySchema = z.object({
  userId: z.string().min(1),
  agentId: z.string().min(1).optional(),
  isSessionAuth: z.boolean().optional(),
  enrollmentCapable: z.boolean().optional(),
  isDeliveryAgent: z.boolean().optional(),
  /** Host-authenticated marker for the dedicated full standalone Hermes audience. */
  isHermesAgent: z.boolean().optional(),
  networkScopeId: z.string().min(1).nullable().optional(),
}).strict().superRefine((identity, ctx) => {
  if (identity.isSessionAuth === true && identity.agentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['agentId'],
      message: 'Session-authenticated identities cannot carry an agent ID.',
    });
  }
  if (identity.isDeliveryAgent === true && !identity.agentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['isDeliveryAgent'],
      message: 'Delivery-agent designation requires an agent ID.',
    });
  }
  if (identity.isHermesAgent === true && !identity.agentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['isHermesAgent'],
      message: 'Hermes-agent designation requires an agent ID.',
    });
  }
});

export type McpResolvedIdentity = z.infer<typeof McpResolvedIdentitySchema>;
