import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { detectBaseline } from './baseline.ts';
import { annotateTrace } from './annotate/run.ts';
import { RecordedCompleter } from './annotate/completer.ts';
import type { Sql } from './db.ts';
import { scoreDetection } from './eval.ts';
import type { DetectionReport } from './eval.ts';
import { loadTrace } from './load.ts';
import { persistRecord } from './persist.ts';
import type { TraceRecord } from './record.ts';
import { AnnotationBundleSchema, FindingKindSchema, OutcomeClassSchema } from './schema.ts';
import type { TraceInput } from './schema.ts';

export const RealGoldSchema = z.object({
  labeler: z.string(),
  cases: z.array(z.object({
    opportunityId: z.string(),
    stratum: z.string(),
    selection: z.string(),
    findings: z.array(z.object({ turnIndex: z.number().int().min(0), kind: FindingKindSchema })),
    outcomeClass: OutcomeClassSchema,
    confidence: z.string(),
    note: z.string(),
  })),
});
export type RealGold = z.infer<typeof RealGoldSchema>;

export interface RealEvalResult {
  cases: number;
  quoteKept: number;
  quoteEmitted: number;
  outcomeMatched: number;
  recordedDetection: DetectionReport;
  baselineDetection: DetectionReport;
  perCase: { id: string; stratum: string; outcomeClass: string; goldOutcomeClass: string; dropped: number }[];
}

export async function evaluateReal(sql: Sql, goldPath: string, annotationDir: string, persist: boolean): Promise<RealEvalResult> {
  const gold = RealGoldSchema.parse(JSON.parse(await readFile(goldPath, 'utf8')));
  const recorded: { id: string; gold: { turnIndex: number; kind: z.infer<typeof FindingKindSchema> }[]; predicted: { turnIndex: number; kind: z.infer<typeof FindingKindSchema> }[] }[] = [];
  const baseline: typeof recorded = [];
  const perCase: RealEvalResult['perCase'] = [];
  let kept = 0;
  let emitted = 0;
  let matched = 0;
  for (const item of gold.cases) {
    const trace = await loadTrace(sql, item.opportunityId);
    if (!trace) throw new Error(`gold case ${item.opportunityId} not found in this database`);
    const bundle = AnnotationBundleSchema.parse(JSON.parse(await readFile(join(annotationDir, `${item.opportunityId}.json`), 'utf8')));
    const record: TraceRecord = await annotateTrace(trace, new RecordedCompleter(bundle));
    if (persist) await persistRecord(sql, record);
    const dropped = record.dropped.length;
    emitted += Object.values(record.emitted).reduce((sum, value) => sum + value, 0);
    kept += record.statements.length + record.fidelity.length + record.turnActs.filter((act) => act.annotated).length + record.claims.length + record.termDeltas.length + record.findings.length;
    if (record.outcome.outcomeClass === item.outcomeClass) matched += 1;
    recorded.push({ id: item.opportunityId, gold: item.findings, predicted: record.findings.map((f) => ({ turnIndex: f.turnIndex, kind: FindingKindSchema.parse(f.kind) })) });
    baseline.push({ id: item.opportunityId, gold: item.findings, predicted: detectBaseline(trace) });
    perCase.push({ id: item.opportunityId, stratum: item.stratum, outcomeClass: record.outcome.outcomeClass, goldOutcomeClass: item.outcomeClass, dropped });
  }
  return {
    cases: gold.cases.length,
    quoteKept: kept,
    quoteEmitted: emitted,
    outcomeMatched: matched,
    recordedDetection: scoreDetection('manual-agent annotations on real cases (same labeler as gold, not independent)', recorded),
    baselineDetection: scoreDetection('keyword baseline on real cases', baseline),
    perCase,
  };
}

export interface ScanHit {
  opportunityId: string;
  turnIndex: number;
  seat: string;
  kind: string;
  excerpt: string;
}

export async function scanBaseline(sql: Sql, limit: number, seed: string): Promise<{ scanned: number; turns: number; hits: ScanHit[] }> {
  const ids = await sql<{ opportunity_id: string }[]>`
    select n.opportunity_id from negotiations n
    where exists (select 1 from negotiation_turns t where t.negotiation_id = n.id)
    order by md5(n.opportunity_id || ${seed}) limit ${limit}
  `;
  const hits: ScanHit[] = [];
  let turns = 0;
  let scanned = 0;
  for (const row of ids) {
    const trace: TraceInput | null = await loadTrace(sql, row.opportunity_id, { turnsOnly: true });
    if (!trace) continue;
    scanned += 1;
    turns += trace.turns.length;
    for (const hit of detectBaseline(trace)) {
      const turn = trace.turns[hit.turnIndex];
      hits.push({ opportunityId: row.opportunity_id, turnIndex: hit.turnIndex, seat: turn?.seat ?? '?', kind: hit.kind, excerpt: (turn?.message ?? '').replace(/\s+/g, ' ').slice(0, 400) });
    }
  }
  return { scanned, turns, hits };
}
