import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detectBaseline } from './baseline.ts';
import { annotateTrace } from './annotate/run.ts';
import { RecordedCompleter, completerFromEnv } from './annotate/completer.ts';
import type { Completer } from './annotate/completer.ts';
import { connect, connectionUrl } from './db.ts';
import { replayFixtures, scoreDetection, corruptQuotes } from './eval.ts';
import type { DetectionReport, Metric } from './eval.ts';
import { loadFixture, loadFixtureDir } from './fixtures.ts';
import { loadTrace } from './load.ts';
import { persistRecord } from './persist.ts';
import { renderTrace } from './annotate/prompts.ts';
import { AnnotationBundleSchema } from './schema.ts';
import type { TraceInput } from './schema.ts';
import type { TraceRecord } from './record.ts';

const USAGE = `trace <command>

  dump <opportunity-id>                    print the pseudonymized trace the annotators would read
  analyze <opportunity-id> [--annotations <file>] [--no-persist] [--json]
  analyze --fixture <file> [--no-persist] [--json]
  eval [--fixtures <dir>]                  replay fixtures through the verifier and score the baseline detector

Environment: TRACE_DATABASE_URL (a dev branch of production, never the primary), OPENROUTER_API_KEY (live annotator, optional).`;

interface Args {
  positional: string[];
  flags: Map<string, string | true>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--') && ['annotations', 'fixture', 'fixtures'].includes(name)) {
      flags.set(name, next);
      index += 1;
    } else flags.set(name, true);
  }
  return { positional, flags };
}

const pct = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(0)}%`);
const fmt = (metric: Metric) => `precision ${pct(metric.precision)}  recall ${pct(metric.recall)}  (tp ${metric.tp}, fp ${metric.fp}, fn ${metric.fn})`;

function printDetection(report: DetectionReport): void {
  console.log(`\n${report.name}`);
  console.log(`  overall                      ${fmt(report.overall)}`);
  for (const [kind, metric] of Object.entries(report.perKind)) console.log(`  ${kind.padEnd(28)} ${fmt(metric)}`);
  for (const item of report.falsePositives) console.log(`  false positive: ${item.id} turn ${item.turnIndex} ${item.kind}`);
  for (const item of report.misses) console.log(`  miss:           ${item.id} turn ${item.turnIndex} ${item.kind}`);
}

function printRecord(record: TraceRecord): void {
  const { interaction, outcome } = record;
  console.log(`${interaction.id}  annotator=${interaction.annotator}  turns=${interaction.turnCount}`);
  console.log(`  agent verdict ${outcome.agentVerdict}, human outcome ${outcome.humanOutcome}, class ${outcome.outcomeClass}`);
  console.log(`  statements ${record.statements.length}, fidelity rows ${record.fidelity.length}, claims ${record.claims.length}, findings ${record.findings.length}`);
  for (const finding of record.findings) console.log(`  finding turn ${finding.turnIndex}: ${finding.kind} (${finding.agentResponse}) ${finding.owaspRef}`);
  const emitted = Object.values(record.emitted).reduce((sum, value) => sum + value, 0);
  console.log(`  dropped ${record.dropped.length} of ${emitted} annotations that failed quote or consistency checks`);
  for (const item of record.dropped) console.log(`    - ${item.layer}: ${item.reason}`);
}

async function chooseCompleter(flags: Args['flags']): Promise<Completer> {
  const file = flags.get('annotations');
  if (typeof file === 'string') return new RecordedCompleter(AnnotationBundleSchema.parse(JSON.parse(await readFile(file, 'utf8'))));
  const live = completerFromEnv();
  if (live) return live;
  throw new Error('no annotator: pass --annotations <file> or set OPENROUTER_API_KEY');
}

async function analyze(args: Args): Promise<void> {
  const flags = args.flags;
  const fixturePath = flags.get('fixture');
  const persist = !flags.has('no-persist');
  let trace: TraceInput;
  let completer: Completer;
  if (typeof fixturePath === 'string') {
    const fixture = await loadFixture(fixturePath);
    trace = fixture.trace;
    completer = flags.has('annotations') ? await chooseCompleter(flags) : new RecordedCompleter(fixture.annotations);
  } else {
    const opportunityId = args.positional[1];
    if (!opportunityId) throw new Error(USAGE);
    const sql = connect(connectionUrl());
    try {
      const loaded = await loadTrace(sql, opportunityId);
      if (!loaded) throw new Error(`no negotiation for opportunity ${opportunityId}`);
      trace = loaded;
    } finally {
      await sql.end();
    }
    completer = await chooseCompleter(flags);
  }
  const record = await annotateTrace(trace, completer);
  if (persist) {
    const sql = connect(connectionUrl());
    try {
      await persistRecord(sql, record);
    } finally {
      await sql.end();
    }
  }
  if (flags.has('json')) console.log(JSON.stringify(record, null, 2));
  else printRecord(record);
}

async function dump(args: Args): Promise<void> {
  const opportunityId = args.positional[1];
  if (!opportunityId) throw new Error(USAGE);
  const sql = connect(connectionUrl());
  try {
    const trace = await loadTrace(sql, opportunityId);
    if (!trace) throw new Error(`no negotiation for opportunity ${opportunityId}`);
    console.log(args.flags.has('json') ? JSON.stringify(trace, null, 2) : renderTrace(trace));
  } finally {
    await sql.end();
  }
}

async function evaluate(args: Args): Promise<void> {
  const dir = args.flags.get('fixtures');
  const fixtures = await loadFixtureDir(typeof dir === 'string' ? dir : join(import.meta.dir, '..', 'fixtures'));
  const attacks = fixtures.filter((fixture) => fixture.gold.findings.length > 0).length;
  console.log(`${fixtures.length} scripted fixtures (${attacks} with seeded conduct, ${fixtures.length - attacks} hard negatives)`);

  const recorded = await replayFixtures('recorded annotations replayed through the verifier (pipeline check, not an annotator measurement)', fixtures);
  printDetection(recorded.report.detection);
  console.log(`  annotations kept after quote check: ${recorded.report.kept} of ${recorded.report.emitted} (${pct(recorded.report.quoteVerifiedRate)})`);
  console.log(`  authority-exceeded turns         ${fmt(recorded.report.authorityExceeded)}`);
  console.log(`  outcome class agreement          ${recorded.report.outcomeClassAgreement.matched}/${recorded.report.outcomeClassAgreement.total}`);
  console.log(`  agent response agreement         ${recorded.report.responseAgreement.matched}/${recorded.report.responseAgreement.total}`);

  const corrupted = await replayFixtures('control: every quote replaced with invented wording', fixtures, corruptQuotes);
  console.log(`\n${corrupted.report.detection.name}`);
  console.log(`  annotations kept: ${corrupted.report.kept} of ${corrupted.report.emitted}; findings stored: ${corrupted.records.reduce((sum, record) => sum + record.findings.length, 0)}`);

  printDetection(scoreDetection('keyword baseline (no model)', fixtures.map((fixture) => ({ id: fixture.id, gold: fixture.gold.findings, predicted: detectBaseline(fixture.trace) }))));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0];
  if (command === 'analyze') return analyze(args);
  if (command === 'dump') return dump(args);
  if (command === 'eval') return evaluate(args);
  console.log(USAGE);
  process.exitCode = command ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
