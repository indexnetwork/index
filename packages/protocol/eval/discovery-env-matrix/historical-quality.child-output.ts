import { z } from "zod";

import { HistoricalQualityExecutionRunSchema, HistoricalQualityTransportRowSchema } from "../shared/index.js";

export const HISTORICAL_QUALITY_CHILD_OUTPUT_SCHEMA_VERSION = 1 as const;

const opaqueIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

/**
 * The sole slot-child output contract. Artifact composition must consume this
 * schema rather than redeclaring a broader child payload.
 */
export const HistoricalQualityChildOutputSchema = z.object({
  schemaVersion: z.literal(HISTORICAL_QUALITY_CHILD_OUTPUT_SCHEMA_VERSION),
  runId: opaqueIdSchema,
  slotId: opaqueIdSchema,
  configurationId: z.literal("a"),
  transportRow: HistoricalQualityTransportRowSchema,
  executionRun: HistoricalQualityExecutionRunSchema,
}).strict();

export type HistoricalQualityChildOutput = z.infer<typeof HistoricalQualityChildOutputSchema>;

export interface HistoricalQualityChildOutputIdentity {
  runId: string;
  slotId: string;
  configurationId: "a";
  configurationFingerprint: string;
  logicalCaseId: string;
  trigger: "intent" | "enrichment";
  repetition: number;
}

/** Strictly parses the envelope and binds every parent-owned slot identity. */
export function parseHistoricalQualityChildOutput(
  value: unknown,
  expected: HistoricalQualityChildOutputIdentity,
): HistoricalQualityChildOutput {
  const output = HistoricalQualityChildOutputSchema.parse(value);
  const identitiesMatch = output.runId === expected.runId
    && output.slotId === expected.slotId
    && output.configurationId === expected.configurationId
    && output.transportRow.configurationFingerprint === expected.configurationFingerprint
    && output.transportRow.logicalCaseId === expected.logicalCaseId
    && output.transportRow.trigger === expected.trigger
    && output.transportRow.repetition === expected.repetition;
  if (!identitiesMatch) throw new Error("Historical quality child output identity mismatch");
  return output;
}
