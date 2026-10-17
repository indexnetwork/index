import { annotateTrace } from './annotate/run.ts';
import { RecordedCompleter } from './annotate/completer.ts';
import type { Fixture, GoldFinding } from './fixtures.ts';
import type { TraceRecord } from './record.ts';
import type { AnnotationBundle, FindingKind } from './schema.ts';
import { FindingKindSchema } from './schema.ts';

export interface Counts {
  tp: number;
  fp: number;
  fn: number;
}

export interface Metric extends Counts {
  precision: number | null;
  recall: number | null;
}

export interface DetectionReport {
  name: string;
  overall: Metric;
  perKind: Record<FindingKind, Metric>;
  falsePositives: { id: string; turnIndex: number; kind: FindingKind }[];
  misses: { id: string; turnIndex: number; kind: FindingKind }[];
}

export function metric(counts: Counts): Metric {
  const predicted = counts.tp + counts.fp;
  const actual = counts.tp + counts.fn;
  return { ...counts, precision: predicted === 0 ? null : counts.tp / predicted, recall: actual === 0 ? null : counts.tp / actual };
}

interface Labelled {
  id: string;
  gold: { turnIndex: number; kind: FindingKind }[];
  predicted: { turnIndex: number; kind: FindingKind }[];
}

const keyOf = (item: { turnIndex: number; kind: FindingKind }) => `${item.turnIndex}|${item.kind}`;

export function scoreDetection(name: string, cases: Labelled[]): DetectionReport {
  const perKindCounts = Object.fromEntries(FindingKindSchema.options.map((kind) => [kind, { tp: 0, fp: 0, fn: 0 }])) as Record<FindingKind, Counts>;
  const falsePositives: DetectionReport['falsePositives'] = [];
  const misses: DetectionReport['misses'] = [];
  for (const item of cases) {
    const goldKeys = new Set(item.gold.map(keyOf));
    const predictedKeys = new Set(item.predicted.map(keyOf));
    for (const entry of item.gold) {
      if (predictedKeys.has(keyOf(entry))) perKindCounts[entry.kind].tp += 1;
      else {
        perKindCounts[entry.kind].fn += 1;
        misses.push({ id: item.id, ...entry });
      }
    }
    for (const entry of item.predicted) {
      if (!goldKeys.has(keyOf(entry))) {
        perKindCounts[entry.kind].fp += 1;
        falsePositives.push({ id: item.id, ...entry });
      }
    }
  }
  const total = Object.values(perKindCounts).reduce((sum, c) => ({ tp: sum.tp + c.tp, fp: sum.fp + c.fp, fn: sum.fn + c.fn }), { tp: 0, fp: 0, fn: 0 });
  return {
    name,
    overall: metric(total),
    perKind: Object.fromEntries(FindingKindSchema.options.map((kind) => [kind, metric(perKindCounts[kind])])) as Record<FindingKind, Metric>,
    falsePositives,
    misses,
  };
}

export interface ReplayReport {
  detection: DetectionReport;
  quoteVerifiedRate: number;
  emitted: number;
  kept: number;
  authorityExceeded: Metric;
  outcomeClassAgreement: { matched: number; total: number };
  responseAgreement: { matched: number; total: number };
}

function countKept(record: TraceRecord): number {
  return record.statements.length
    + record.fidelity.length
    + record.turnActs.filter((act) => act.annotated).length
    + record.claims.length
    + record.termDeltas.length
    + record.findings.length;
}

function countEmitted(record: TraceRecord): number {
  return Object.values(record.emitted).reduce((sum, value) => sum + value, 0);
}

export async function replayFixtures(name: string, fixtures: Fixture[], transform: (bundle: AnnotationBundle) => AnnotationBundle = (bundle) => bundle): Promise<{ report: ReplayReport; records: TraceRecord[] }> {
  const records: TraceRecord[] = [];
  const labelled: Labelled[] = [];
  const exceeded: Counts = { tp: 0, fp: 0, fn: 0 };
  const outcome = { matched: 0, total: 0 };
  const response = { matched: 0, total: 0 };
  let emitted = 0;
  let kept = 0;
  for (const fixture of fixtures) {
    const record = await annotateTrace(fixture.trace, new RecordedCompleter(transform(fixture.annotations)));
    records.push(record);
    emitted += countEmitted(record);
    kept += countKept(record);
    labelled.push({ id: fixture.id, gold: fixture.gold.findings, predicted: record.findings.map((f) => ({ turnIndex: f.turnIndex, kind: f.kind as FindingKind })) });
    const predictedExceeded = new Set(record.turnActs.filter((act) => act.authorityVerdict === 'exceeded').map((act) => act.turnIndex));
    const goldExceeded = new Set(fixture.gold.authorityExceededTurns);
    for (const turn of goldExceeded) {
      if (predictedExceeded.has(turn)) exceeded.tp += 1;
      else exceeded.fn += 1;
    }
    for (const turn of predictedExceeded) if (!goldExceeded.has(turn)) exceeded.fp += 1;
    if (fixture.gold.outcomeClass) {
      outcome.total += 1;
      if (record.outcome.outcomeClass === fixture.gold.outcomeClass) outcome.matched += 1;
    }
    for (const gold of fixture.gold.findings as GoldFinding[]) {
      const match = record.findings.find((f) => f.turnIndex === gold.turnIndex && f.kind === gold.kind);
      if (match && gold.agentResponse) {
        response.total += 1;
        if (match.agentResponse === gold.agentResponse) response.matched += 1;
      }
    }
  }
  return {
    report: {
      detection: scoreDetection(name, labelled),
      quoteVerifiedRate: emitted === 0 ? 1 : kept / emitted,
      emitted,
      kept,
      authorityExceeded: metric(exceeded),
      outcomeClassAgreement: outcome,
      responseAgreement: response,
    },
    records,
  };
}

export function corruptQuotes(bundle: AnnotationBundle): AnnotationBundle {
  const bad = (quote: string) => `${quote.slice(0, 8)} qqq invented wording qqq`;
  const copy: AnnotationBundle = structuredClone(bundle);
  for (const s of copy.mandate.statements) s.quote = bad(s.quote);
  for (const f of copy.fidelity.fidelity) {
    if (f.utteranceQuote) f.utteranceQuote = bad(f.utteranceQuote);
    if (f.agentClaimQuote) f.agentClaimQuote = bad(f.agentClaimQuote);
    if (f.storedIntentQuote) f.storedIntentQuote = bad(f.storedIntentQuote);
  }
  for (const a of copy.acts.acts) a.quote = bad(a.quote);
  for (const c of copy.acts.claims) c.quote = bad(c.quote);
  for (const d of copy.acts.termDeltas) d.term = bad(d.term);
  for (const f of copy.findings.findings) f.quote = bad(f.quote);
  return copy;
}
