import { sql, type SQL } from 'drizzle-orm';

import * as schema from '../schemas/database.schema';

export interface HermesResponseMetadataSqlInput {
  completedBinding: unknown;
  receipt: unknown;
  parkGeneration: string | null;
  parkStartedAt: string | null;
}

export function buildNegotiationParkMetadataSql(parkGeneration: string): SQL {
  return sql`COALESCE(${schema.tasks.metadata}, '{}'::jsonb) || jsonb_build_object(
    'negotiationParkGeneration', ${parkGeneration}::text
  )`;
}

export function buildHermesResponseMetadataSql(input: HermesResponseMetadataSqlInput): SQL {
  return sql`COALESCE(${schema.tasks.metadata}, '{}'::jsonb) || jsonb_build_object(
    'hermesRunCapability', ${JSON.stringify(input.completedBinding)}::jsonb,
    'hermesResponseReceipt', ${JSON.stringify(input.receipt)}::jsonb,
    'negotiationParkGeneration', ${input.parkGeneration}::text,
    'hermesParkStartedAt', ${input.parkStartedAt}::text
  )`;
}
