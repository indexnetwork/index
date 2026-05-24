import { z } from 'zod';

export const EventNetworkMetadataSchema = z.object({
  startDate: z.string().datetime({ message: 'startDate must be ISO-8601' }),
  endDate: z.string().datetime({ message: 'endDate must be ISO-8601' }),
  timezone: z.string().optional(),
  location: z.string().optional(),
  themes: z.array(z.string()).optional(),
  events: z.array(z.object({
    externalId: z.string(),
    title: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    location: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    syncedAt: z.string().optional(),
  })).optional().default([]),
}).refine(
  (data) => new Date(data.endDate) > new Date(data.startDate),
  { message: 'endDate must be after startDate', path: ['endDate'] },
);

export const CommunityNetworkMetadataSchema = z.object({}).passthrough();

export const NetworkMemberMetadataSchema = z.record(z.string(), z.unknown());

export const SyncConfigSchema = z.object({
  intervalMs: z.number().min(60_000).optional().default(900_000),
  lastSyncAt: z.string().datetime().optional(),
  calendarId: z.string().trim().min(1).optional().default('primary'),
  status: z.enum(['active', 'paused', 'error']).optional().default('paused'),
});

export const ContextInjectionSchema = z.object({
  discovery: z.boolean().optional().default(true),
});

export type EventNetworkMetadata = z.infer<typeof EventNetworkMetadataSchema>;
export type NetworkMemberMetadata = z.infer<typeof NetworkMemberMetadataSchema>;
export type SyncConfig = z.infer<typeof SyncConfigSchema>;

export function validateNetworkMetadata(type: 'community' | 'event', metadata: unknown): Record<string, unknown> {
  if (type === 'event') {
    return EventNetworkMetadataSchema.parse(metadata);
  }
  return CommunityNetworkMetadataSchema.parse(metadata ?? {});
}
