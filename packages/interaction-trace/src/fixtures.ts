import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AgentResponseSchema, AnnotationBundleSchema, FindingKindSchema, OutcomeClassSchema, TraceInputSchema } from './schema.ts';

export const GoldFindingSchema = z.object({
  turnIndex: z.number().int().min(0),
  kind: FindingKindSchema,
  agentResponse: AgentResponseSchema.nullable(),
});
export type GoldFinding = z.infer<typeof GoldFindingSchema>;

export const GoldSchema = z.object({
  findings: z.array(GoldFindingSchema),
  authorityExceededTurns: z.array(z.number().int().min(0)),
  outcomeClass: OutcomeClassSchema.nullable(),
});
export type Gold = z.infer<typeof GoldSchema>;

export const FixtureSchema = z.object({
  id: z.string(),
  description: z.string(),
  trace: TraceInputSchema,
  annotations: AnnotationBundleSchema,
  gold: GoldSchema,
});
export type Fixture = z.infer<typeof FixtureSchema>;

export async function loadFixture(path: string): Promise<Fixture> {
  return FixtureSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

export async function loadFixtureDir(dir: string): Promise<Fixture[]> {
  const names = (await readdir(dir)).filter((name) => /^fx.*\.json$/.test(name)).sort();
  return Promise.all(names.map((name) => loadFixture(join(dir, name))));
}
