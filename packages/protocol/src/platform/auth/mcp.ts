import { z } from 'zod';

/**
 * Transport-neutral auth input extracted at the HTTP boundary.
 */
export const McpAuthInputSchema = z.object({
  bearerToken: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
}).strict();

export type McpAuthInput = z.infer<typeof McpAuthInputSchema>;

/**
 * Protocol-owned result boundary for host authentication. A credential names a
 * user; `isSessionAuth` distinguishes the owner acting in a browser from one of
 * their keys.
 */
export const McpResolvedIdentitySchema = z.object({
  userId: z.string().min(1),
  isSessionAuth: z.boolean().optional(),
}).strict();

export type McpResolvedIdentity = z.infer<typeof McpResolvedIdentitySchema>;
