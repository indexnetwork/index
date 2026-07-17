#!/usr/bin/env bun
import { access, chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseHydeJudgmentArtifact, parseHydeResolvedAdjudicationArtifact, parseHydeResolverDecisionsArtifact, resolveAdjudications } from './hyde.adjudication.js';
import { analyzeHydeEvidence } from './hyde.analysis.js';
import { buildBlindExport, fingerprintHydeArtifact, parseHydeAnalysisArtifact, parseHydeBlindPrivateKey, parseHydeBlindPublicBatch, parseHydeCollectionArtifact } from './hyde.artifacts.js';
import { assertFrozenHydeCorpus, HYDE_CASES, HYDE_CORPUS_FINGERPRINT } from './hyde.cases.js';
import { HYDE_CANONICAL_RUNS } from './hyde.policy.js';
import { assertCanonicalHydeCollectionPreflight } from './hyde.preflight.js';
import type { HydeCollectionArtifact } from './hyde.schemas.js';
import { buildHydeEvidenceReport, renderHydeEvidenceMarkdown } from './hyde.report.js';
import { collectHydeEvidence, type HydeCollectionProgress } from './hyde.runner.js';

const STAGES = [
  'list-cases',
  'validate-corpus',
  'collect',
  'export',
  'resolve',
  'analyze',
  'report',
] as const;

type HydeEvalStage = typeof STAGES[number];
type HydeEvalCollector = typeof collectHydeEvidence;
type OutputWriter = (text: string) => void;

export interface HydeEvalCliDeps {
  collector?: HydeEvalCollector;
  now?: () => Date;
  stdout?: OutputWriter;
  stderr?: OutputWriter;
}

interface ParsedArguments {
  stage: HydeEvalStage;
  values: Map<string, string[]>;
  force: boolean;
}

const VALUE_OPTIONS: Readonly<Record<HydeEvalStage, readonly string[]>> = {
  'list-cases': ['--case'],
  'validate-corpus': [],
  collect: ['--out', '--case', '--runs', '--study-id'],
  export: ['--collection', '--public', '--private-key', '--template'],
  resolve: ['--batch', '--judgment', '--resolver', '--out'],
  analyze: ['--collection', '--private-key', '--resolved', '--judgment', '--resolver', '--out'],
  report: ['--analysis', '--collection', '--private-key', '--resolved', '--judgment', '--resolver', '--json', '--markdown'],
};

const FORCE_STAGES = new Set<HydeEvalStage>(['collect', 'export', 'resolve', 'analyze', 'report']);
let temporaryFileCounter = 0;

function usage(): string {
  return `Staged HyDE evidence eval\n\n` +
    `Usage (from packages/protocol):\n` +
    `  bun run eval:hyde -- list-cases [--case prefix]\n` +
    `  bun run eval:hyde -- validate-corpus\n` +
    `  bun run eval:hyde -- collect --out PATH [--case prefix] [--runs EVEN] [--study-id ID] [--force]\n` +
    `  bun run eval:hyde -- export --collection PATH --public PATH --private-key PATH --template PATH [--force]\n` +
    `  bun run eval:hyde -- resolve --batch PATH --judgment PATH --judgment PATH [--resolver PATH] --out PATH [--force]\n` +
    `  bun run eval:hyde -- analyze --collection PATH --private-key PATH --resolved PATH --judgment PATH --judgment PATH [--resolver PATH] --out PATH [--force]\n` +
    `  bun run eval:hyde -- report --analysis PATH --collection PATH --private-key PATH --resolved PATH --judgment PATH --judgment PATH [--resolver PATH] [--json PATH] [--markdown PATH] [--force]\n\n` +
    `Exit codes: 0 success/pass; 1 complete canonical evidence fails gates; ` +
    `2 argument/artifact/execution error; 3 incomplete, noncanonical, or insufficient evidence.\n`;
}

function isStage(value: string): value is HydeEvalStage {
  return (STAGES as readonly string[]).includes(value);
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const stage = args[0];
  if (!stage || !isStage(stage)) {
    throw new Error(stage ? `Unknown HyDE eval stage: ${stage}` : 'A HyDE eval stage is required');
  }
  const allowed = new Set(VALUE_OPTIONS[stage]);
  const values = new Map<string, string[]>();
  let force = false;
  for (let index = 1; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--force') {
      if (!FORCE_STAGES.has(stage)) throw new Error(`--force is not valid for ${stage}`);
      if (force) throw new Error('--force may be supplied only once');
      force = true;
      continue;
    }
    if (!allowed.has(token)) throw new Error(`Unknown option for ${stage}: ${token}`);
    const optionValue = args[index + 1];
    if (!optionValue || optionValue.startsWith('--')) throw new Error(`${token} requires a value`);
    index += 1;
    const prior = values.get(token) ?? [];
    if (token !== '--judgment' && prior.length > 0) throw new Error(`${token} may be supplied only once`);
    values.set(token, [...prior, optionValue]);
  }
  return { stage, values, force };
}

function valuesOf(parsed: ParsedArguments, flag: string): string[] {
  return parsed.values.get(flag) ?? [];
}

function optionalValue(parsed: ParsedArguments, flag: string): string | undefined {
  return valuesOf(parsed, flag)[0];
}

function requiredValue(parsed: ParsedArguments, flag: string): string {
  const value = optionalValue(parsed, flag);
  if (!value) throw new Error(`${parsed.stage} requires ${flag} PATH`);
  return value;
}

function evenRuns(raw: string | undefined): number {
  if (raw === undefined) return HYDE_CANONICAL_RUNS;
  const runs = Number(raw);
  if (!Number.isInteger(runs) || runs < 2 || runs % 2 !== 0) {
    throw new Error(`--runs must be a positive even integer (got ${raw})`);
  }
  return runs;
}

function selectedCases(prefix: string | undefined) {
  if (!prefix) return HYDE_CASES;
  const selected = HYDE_CASES.filter((candidate) =>
    candidate.id === prefix || candidate.id.startsWith(prefix));
  if (selected.length === 0) throw new Error(`No HyDE eval case matches ${prefix}`);
  return selected;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function targetExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return false;
    throw error;
  }
}

function assertNoInputOutputCollisions(
  inputPaths: readonly string[],
  outputPaths: readonly string[],
): void {
  const inputs = new Set(inputPaths.map((inputPath) => path.resolve(inputPath)));
  for (const outputPath of outputPaths.map((candidate) => path.resolve(candidate))) {
    if (inputs.has(outputPath)) {
      throw new Error(`Output path must not overwrite an input artifact: ${outputPath}`);
    }
  }
}

async function assertWritableTargets(targetPaths: readonly string[], force: boolean): Promise<void> {
  const resolved = targetPaths.map((targetPath) => path.resolve(targetPath));
  if (new Set(resolved).size !== resolved.length) throw new Error('Output paths must be distinct');
  if (force) return;
  for (const targetPath of resolved) {
    if (await targetExists(targetPath)) {
      throw new Error(`Refusing to overwrite existing file without --force: ${targetPath}`);
    }
  }
}

async function atomicWrite(
  targetPath: string,
  content: string,
  options: { force: boolean; mode?: number },
): Promise<void> {
  const resolved = path.resolve(targetPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  if (!options.force && await targetExists(resolved)) {
    throw new Error(`Refusing to overwrite existing file without --force: ${resolved}`);
  }
  temporaryFileCounter += 1;
  const temporaryPath = path.join(
    path.dirname(resolved),
    `.${path.basename(resolved)}.tmp-${process.pid}-${temporaryFileCounter}`,
  );
  try {
    await writeFile(temporaryPath, content, {
      encoding: 'utf8',
      flag: 'wx',
      mode: options.mode ?? 0o666,
    });
    await rename(temporaryPath, resolved);
    if (options.mode !== undefined) await chmod(resolved, options.mode);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function readJson(jsonPath: string): Promise<unknown> {
  const resolved = path.resolve(jsonPath);
  let text: string;
  try {
    text = await readFile(resolved, 'utf8');
  } catch (error) {
    throw new Error(`Failed to read JSON at ${resolved}: ${errorMessage(error)}`, { cause: error });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Malformed JSON at ${resolved}: ${errorMessage(error)}`, { cause: error });
  }
}

async function readArtifact<T>(
  artifactPath: string,
  parser: (value: unknown) => T,
): Promise<T> {
  const resolved = path.resolve(artifactPath);
  const value = await readJson(resolved);
  try {
    return parser(value);
  } catch (error) {
    throw new Error(`Invalid artifact at ${resolved}: ${errorMessage(error)}`, { cause: error });
  }
}

function progressLine(progress: HydeCollectionProgress): string {
  const identity = progress.phase === 'candidate-embedding'
    ? `${progress.caseId} candidates`
    : `${progress.caseId} run ${progress.run} ${progress.mode}`;
  return `[${progress.completedOperations}/${progress.totalOperations}] ${identity}: ${progress.status}`;
}

function exitCodeForGateStatus(status: 'pass' | 'fail' | 'insufficient'): number {
  if (status === 'pass') return 0;
  return status === 'fail' ? 1 : 3;
}

/** Reject blind export unless every collection-only canonical preflight check passes. */
export function assertExportableCollection(collection: HydeCollectionArtifact): void {
  assertCanonicalHydeCollectionPreflight(collection, HYDE_CASES);
}

async function runStage(parsed: ParsedArguments, deps: HydeEvalCliDeps): Promise<number> {
  const stdout = deps.stdout ?? console.log;
  const collector = deps.collector ?? collectHydeEvidence;
  const now = deps.now ?? (() => new Date());

  if (parsed.stage === 'list-cases') {
    for (const candidate of selectedCases(optionalValue(parsed, '--case'))) {
      stdout(`${candidate.id}\t${candidate.stratum}\t${candidate.backgroundSource}\t${candidate.description}`);
    }
    return 0;
  }

  if (parsed.stage === 'validate-corpus') {
    assertFrozenHydeCorpus(HYDE_CASES);
    const candidateCount = HYDE_CASES.reduce((sum, candidate) => sum + candidate.candidates.length, 0);
    stdout(`HyDE corpus valid: cases=${HYDE_CASES.length}; candidates=${candidateCount}; fingerprint=${HYDE_CORPUS_FINGERPRINT}`);
    return 0;
  }

  if (parsed.stage === 'collect') {
    const outputPath = requiredValue(parsed, '--out');
    const cases = selectedCases(optionalValue(parsed, '--case'));
    const runs = evenRuns(optionalValue(parsed, '--runs'));
    await assertWritableTargets([outputPath], parsed.force);
    const collection = await collector({
      selectedCaseIds: cases.map((candidate) => candidate.id),
      runs,
      ...(optionalValue(parsed, '--study-id') ? { studyId: optionalValue(parsed, '--study-id') } : {}),
      ...(deps.now ? { now } : {}),
      onProgress: (progress) => stdout(progressLine(progress)),
      ...(parsed.force
        ? { additionalNoncanonicalReasons: ['collection output overwrite was forced with --force'] }
        : {}),
    });
    await atomicWrite(outputPath, jsonText(collection), { force: parsed.force });
    stdout(`Collection written: ${path.resolve(outputPath)}; canonical=${collection.canonicality.candidate}; reasons=${collection.canonicality.reasons.length}`);
    return collection.canonicality.candidate ? 0 : 3;
  }

  if (parsed.stage === 'export') {
    const collectionPath = requiredValue(parsed, '--collection');
    const publicPath = requiredValue(parsed, '--public');
    const privatePath = requiredValue(parsed, '--private-key');
    const templatePath = requiredValue(parsed, '--template');
    assertNoInputOutputCollisions(
      [collectionPath],
      [publicPath, privatePath, templatePath],
    );
    await assertWritableTargets([publicPath, privatePath, templatePath], parsed.force);
    const collection = await readArtifact(collectionPath, parseHydeCollectionArtifact);
    assertExportableCollection(collection);
    const exported = buildBlindExport(collection, HYDE_CASES, { createdAt: now().toISOString() });
    await atomicWrite(publicPath, jsonText(exported.publicBatch), { force: parsed.force });
    await atomicWrite(privatePath, jsonText(exported.privateKey), { force: parsed.force, mode: 0o600 });
    await atomicWrite(templatePath, jsonText(exported.judgmentTemplate), { force: parsed.force });
    stdout(`Blind export written: public=${path.resolve(publicPath)}; private=${path.resolve(privatePath)}; template=${path.resolve(templatePath)}`);
    return 0;
  }

  if (parsed.stage === 'resolve') {
    const batchPath = requiredValue(parsed, '--batch');
    const judgmentPaths = valuesOf(parsed, '--judgment');
    if (judgmentPaths.length < 2) throw new Error('resolve requires --judgment PATH at least twice');
    const outputPath = requiredValue(parsed, '--out');
    const resolverPath = optionalValue(parsed, '--resolver');
    assertNoInputOutputCollisions(
      [batchPath, ...judgmentPaths, ...(resolverPath ? [resolverPath] : [])],
      [outputPath],
    );
    await assertWritableTargets([outputPath], parsed.force);
    const batch = await readArtifact(batchPath, parseHydeBlindPublicBatch);
    const judgments = await Promise.all(judgmentPaths.map((judgmentPath) =>
      readArtifact(judgmentPath, parseHydeJudgmentArtifact)));
    const resolver = resolverPath
      ? await readArtifact(resolverPath, parseHydeResolverDecisionsArtifact)
      : undefined;
    const resolved = resolveAdjudications(batch, judgments, resolver, {
      createdAt: now().toISOString(),
    });
    await atomicWrite(outputPath, jsonText(resolved), { force: parsed.force });
    stdout(`Resolved adjudication written: ${path.resolve(outputPath)}; status=${resolved.status}; canonical=${resolved.canonical}`);
    return resolved.status === 'complete' && resolved.canonical ? 0 : 3;
  }

  if (parsed.stage === 'analyze') {
    const collectionPath = requiredValue(parsed, '--collection');
    const privatePath = requiredValue(parsed, '--private-key');
    const resolvedPath = requiredValue(parsed, '--resolved');
    const judgmentPaths = valuesOf(parsed, '--judgment');
    if (judgmentPaths.length < 2) throw new Error('analyze requires --judgment PATH at least twice');
    const outputPath = requiredValue(parsed, '--out');
    const resolverPath = optionalValue(parsed, '--resolver');
    assertNoInputOutputCollisions(
      [collectionPath, privatePath, resolvedPath, ...judgmentPaths, ...(resolverPath ? [resolverPath] : [])],
      [outputPath],
    );
    await assertWritableTargets([outputPath], parsed.force);
    const collection = await readArtifact(collectionPath, parseHydeCollectionArtifact);
    const privateKey = await readArtifact(privatePath, parseHydeBlindPrivateKey);
    const resolved = await readArtifact(resolvedPath, parseHydeResolvedAdjudicationArtifact);
    const judgments = await Promise.all(judgmentPaths.map((judgmentPath) =>
      readArtifact(judgmentPath, parseHydeJudgmentArtifact)));
    const resolver = resolverPath
      ? await readArtifact(resolverPath, parseHydeResolverDecisionsArtifact)
      : undefined;
    const analysis = analyzeHydeEvidence(collection, privateKey, resolved, HYDE_CASES, {
      judgmentArtifacts: judgments,
      ...(resolver ? { resolverDecisions: resolver } : {}),
    });
    await atomicWrite(outputPath, jsonText(analysis), { force: parsed.force });
    stdout(`Analysis written: ${path.resolve(outputPath)}; gates=${analysis.gates.overall}`);
    return exitCodeForGateStatus(analysis.gates.overall);
  }

  const analysisPath = requiredValue(parsed, '--analysis');
  const collectionPath = requiredValue(parsed, '--collection');
  const privatePath = requiredValue(parsed, '--private-key');
  const resolvedPath = requiredValue(parsed, '--resolved');
  const judgmentPaths = valuesOf(parsed, '--judgment');
  if (judgmentPaths.length < 2) throw new Error('report requires --judgment PATH at least twice');
  const resolverPath = optionalValue(parsed, '--resolver');
  const jsonPath = optionalValue(parsed, '--json');
  const markdownPath = optionalValue(parsed, '--markdown');
  if (!jsonPath && !markdownPath) throw new Error('report requires at least one of --json PATH or --markdown PATH');
  const outputs = [jsonPath, markdownPath].filter((value): value is string => value !== undefined);
  assertNoInputOutputCollisions(
    [analysisPath, collectionPath, privatePath, resolvedPath, ...judgmentPaths, ...(resolverPath ? [resolverPath] : [])],
    outputs,
  );
  await assertWritableTargets(outputs, parsed.force);
  const analysis = await readArtifact(analysisPath, parseHydeAnalysisArtifact);
  const collection = await readArtifact(collectionPath, parseHydeCollectionArtifact);
  const privateKey = await readArtifact(privatePath, parseHydeBlindPrivateKey);
  const resolved = await readArtifact(resolvedPath, parseHydeResolvedAdjudicationArtifact);
  const judgments = await Promise.all(judgmentPaths.map((judgmentPath) =>
    readArtifact(judgmentPath, parseHydeJudgmentArtifact)));
  const resolver = resolverPath
    ? await readArtifact(resolverPath, parseHydeResolverDecisionsArtifact)
    : undefined;
  const recomputed = analyzeHydeEvidence(collection, privateKey, resolved, HYDE_CASES, {
    judgmentArtifacts: judgments,
    ...(resolver ? { resolverDecisions: resolver } : {}),
  });
  if (fingerprintHydeArtifact(analysis) !== fingerprintHydeArtifact(recomputed)) {
    throw new Error('Analysis artifact does not match recomputation from its supplied parent artifacts');
  }
  const report = buildHydeEvidenceReport(recomputed);
  if (jsonPath) await atomicWrite(jsonPath, jsonText(report), { force: parsed.force });
  if (markdownPath) {
    await atomicWrite(markdownPath, renderHydeEvidenceMarkdown(report), { force: parsed.force });
  }
  stdout(`Report written: ${outputs.map((output) => path.resolve(output)).join(', ')}; gates=${report.gates.overall}`);
  return exitCodeForGateStatus(report.gates.overall);
}

/** Execute one staged HyDE eval command without mutating process.exitCode. */
export async function runHydeEvalCli(
  args: readonly string[],
  deps: HydeEvalCliDeps = {},
): Promise<number> {
  const stdout = deps.stdout ?? console.log;
  const stderr = deps.stderr ?? console.error;
  if (args.includes('--help') || args.includes('-h')) {
    stdout(usage());
    return 0;
  }
  try {
    const parsed = parseArguments(args);
    return await runStage(parsed, deps);
  } catch (error) {
    if (args.length === 0 || !isStage(args[0] ?? '')) stdout(usage());
    stderr(errorMessage(error));
    return 2;
  }
}

if (import.meta.main) {
  runHydeEvalCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
