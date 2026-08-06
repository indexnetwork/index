import { z } from 'zod';

export const NetworkMemberMetadataSchema = z.record(z.string(), z.unknown());

export const ContextInjectionSchema = z.object({
  discovery: z.boolean().optional().default(true),
});

export const NetworkPermissionsSchema = z.object({
  joinPolicy: z.enum(['anyone', 'invite_only']).optional(),
  allowGuestVibeCheck: z.boolean().optional(),
  contextInjection: ContextInjectionSchema.optional(),
});

export type NetworkMemberMetadata = z.infer<typeof NetworkMemberMetadataSchema>;

export function validateNetworkMetadata(metadata: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(metadata ?? {});
}
