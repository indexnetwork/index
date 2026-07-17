import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'bun:test';

import { buildHydeJudgmentArtifact } from '../hyde.adjudication.js';
import { parseHydeAnalysisArtifact, parseHydeBlindPublicBatch } from '../hyde.artifacts.js';
import { runHydeEvalCli } from '../hyde.eval.js';
import { evaluateHydeGates } from '../hyde.gates.js';
import { HYDE_BOOTSTRAP_REPLICATES, HYDE_BOOTSTRAP_SEED, HYDE_EXPECTED_CANDIDATE_COUNT, HYDE_EXPECTED_CASE_COUNT, HYDE_EXPECTED_PAIR_COUNT } from '../hyde.policy.js';
import type { CollectHydeEvidenceOptions } from '../hyde.runner.js';
import type { HydeAnalysisArtifact, HydeCollectionArtifact } from '../hyde.schemas.js';
import { HYDE_EVAL_STRATA } from '../hyde.types.js';
import { buildCollectionFixture, buildExportableCollectionFixture, humanJudgment, judgmentsForBatch } from './hyde.artifact-fixtures.js';

async function tempDirectory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'hyde-eval-cli-'));
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    deps: {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
      now: () => new Date('2026-03-01T00:00:00.000Z'),
    },
  };
}

function withGateStatus(
  source: HydeAnalysisArtifact,
  status: 'pass' | 'fail' | 'insufficient',
): HydeAnalysisArtifact {
  if (status === 'insufficient') return source;
  const artifact = structuredClone(source) as HydeAnalysisArtifact;
  const provenance = {
    seed: HYDE_BOOTSTRAP_SEED,
    prng: 'mulberry32-v1' as const,
    replicateCount: HYDE_BOOTSTRAP_REPLICATES,
    quantileMethod: 'linear-interpolation-r7' as const,
  };
  const paired = (deltaUpper: number, frameUpper = 0.01) => ({
    available: true as const,
    pointEstimate: { legacy: 0, frameV1: 0, delta: 0 },
    confidenceIntervals: {
      legacy: { lower: 0, upper: 0.01 },
      frameV1: { lower: 0, upper: frameUpper },
      delta: { lower: -0.01, upper: deltaUpper },
    },
    provenance,
    perStratum: HYDE_EVAL_STRATA.map((stratum) => ({ stratum, legacy: 0, frameV1: 0, delta: 0 })),
  });
  const scalar = {
    available: true as const,
    pointEstimate: 0,
    confidenceInterval: { lower: 0, upper: 0.01 },
    provenance,
    perStratum: HYDE_EVAL_STRATA.map((stratum) => ({ stratum, value: 0 })),
  };
  artifact.canonicality = { status: 'canonical', reasons: [] };
  artifact.completeness = {
    ...artifact.completeness,
    observedPairCount: HYDE_EXPECTED_PAIR_COUNT,
    completedPairCount: HYDE_EXPECTED_PAIR_COUNT,
    failedPairCount: 0,
    missingPairCount: 0,
    incompletePairCount: 0,
    incompletePairRate: 0,
    candidateMappingCount: artifact.completeness.expectedCandidateMappingCount,
    generatedDocumentMappingCount: artifact.completeness.expectedGeneratedDocumentMappingCount,
  };
  artifact.adjudication.status = 'complete';
  artifact.adjudication.canonical = true;
  artifact.adjudication.coverage.completeAttestedHumanAdjudicatorCount = 2;
  artifact.adjudication.coverage.invalidHumanArtifactCount = 0;
  artifact.adjudication.counts.unresolved = 0;
  artifact.adjudication.counts.missingEvidence = 0;
  artifact.metrics = {
    precisionAt5: paired(0),
    ndcgAt5: paired(0),
    hardNegativeFprAt5: paired(0),
    margin: paired(0),
    unsupportedAdditionRate: paired(0),
    groundingErrorRate: paired(status === 'fail' ? 0 : -0.01, 0.01),
    frameAllRejectedRate: scalar,
    frameFailedOpenRate: scalar,
  };
  artifact.gates = evaluateHydeGates(artifact.metrics);
  return parseHydeAnalysisArtifact(artifact);
}

async function exportedFixture(directory: string) {
  await mkdir(directory, { recursive: true });
  const collectionPath = path.join(directory, 'collection.json');
  const publicPath = path.join(directory, 'public.json');
  const privatePath = path.join(directory, 'private.json');
  const templatePath = path.join(directory, 'template.json');
  await writeJson(collectionPath, buildExportableCollectionFixture());
  const output = capture();
  const code = await runHydeEvalCli([
    'export',
    '--collection', collectionPath,
    '--public', publicPath,
    '--private-key', privatePath,
    '--template', templatePath,
  ], output.deps);
  expect(code).toBe(0);
  const batch = parseHydeBlindPublicBatch(JSON.parse(await readFile(publicPath, 'utf8')) as unknown);
  return { collectionPath, publicPath, privatePath, templatePath, batch };
}

describe('staged HyDE eval CLI arguments', () => {
  it('prints help, rejects the old no-subcommand form, and never calls the collector', async () => {
    let collectorCalls = 0;
    const output = capture();
    const collector = async (): Promise<HydeCollectionArtifact> => {
      collectorCalls += 1;
      throw new Error('collector must not run');
    };

    expect(await runHydeEvalCli(['--help'], { ...output.deps, collector })).toBe(0);
    expect(await runHydeEvalCli([], { ...output.deps, collector })).toBe(2);
    expect(await runHydeEvalCli(['--runs', '4'], { ...output.deps, collector })).toBe(2);
    expect(collectorCalls).toBe(0);
    expect(output.stdout.join('\n')).toContain('Staged HyDE evidence eval');
  });

  it('validates stage options, even runs, and repeated judgment flags', async () => {
    const output = capture();
    expect(await runHydeEvalCli(['collect', '--out', '/tmp/x', '--runs', '3'], output.deps)).toBe(2);
    expect(output.stderr[output.stderr.length - 1]).toContain('positive even integer');

    expect(await runHydeEvalCli([
      'resolve', '--batch', '/tmp/batch', '--judgment', '/tmp/one', '--out', '/tmp/out',
    ], output.deps)).toBe(2);
    expect(output.stderr[output.stderr.length - 1]).toContain('at least twice');

    expect(await runHydeEvalCli([
      'analyze', '--collection', '/tmp/collection', '--private-key', '/tmp/private',
      '--resolved', '/tmp/resolved', '--judgment', '/tmp/one', '--out', '/tmp/out',
    ], output.deps)).toBe(2);
    expect(output.stderr[output.stderr.length - 1]).toContain('at least twice');

    expect(await runHydeEvalCli([
      'report', '--analysis', '/tmp/analysis', '--collection', '/tmp/collection',
      '--private-key', '/tmp/private', '--resolved', '/tmp/resolved',
      '--judgment', '/tmp/one', '--judgment', '/tmp/two',
    ], output.deps)).toBe(2);
    expect(output.stderr[output.stderr.length - 1]).toContain('at least one');
    expect(await runHydeEvalCli(['validate-corpus', '--force'], output.deps)).toBe(2);
  });

  it('lists filtered cases and validates the frozen corpus without providers', async () => {
    const listed = capture();
    expect(await runHydeEvalCli([
      'list-cases', '--case', 'profile-context-contamination/',
    ], listed.deps)).toBe(0);
    expect(listed.stdout).toHaveLength(15);
    expect(listed.stdout[0]?.split('\t')).toHaveLength(4);
    expect(listed.stdout.every((line) => line.split('\t')[2] === 'saved-intent')).toBeTrue();

    const contextListed = capture();
    expect(await runHydeEvalCli(['list-cases', '--case', 'entity-location-substitution/ctx-'], contextListed.deps)).toBe(0);
    expect(contextListed.stdout.length).toBeGreaterThan(0);
    expect(contextListed.stdout.every((line) => line.split('\t')[2] === 'user-context')).toBeTrue();

    const validated = capture();
    expect(await runHydeEvalCli(['validate-corpus'], validated.deps)).toBe(0);
    expect(validated.stdout[0]).toContain(`cases=${HYDE_EXPECTED_CASE_COUNT}; candidates=${HYDE_EXPECTED_CANDIDATE_COUNT}; fingerprint=`);
  });
});

describe('staged HyDE eval CLI files', () => {
  it('passes canonical collection defaults, reports progress, and marks --force noncanonical', async () => {
    const directory = await tempDirectory();
    const outputPath = path.join(directory, 'nested', 'collection.json');
    const output = capture();
    let observedOptions: CollectHydeEvidenceOptions | undefined;
    const collection = buildCollectionFixture();
    const code = await runHydeEvalCli([
      'collect', '--out', outputPath, '--study-id', 'cli-study', '--force',
    ], {
      ...output.deps,
      collector: async (options = {}) => {
        observedOptions = options;
        options.onProgress?.({
          completedOperations: 1,
          totalOperations: 1,
          phase: 'candidate-embedding',
          caseId: collection.config.selectedCaseIds[0],
          status: 'completed',
        });
        return {
          ...collection,
          studyId: options.studyId ?? collection.studyId,
          canonicality: {
            candidate: false,
            reasons: [...collection.canonicality.reasons, ...(options.additionalNoncanonicalReasons ?? [])],
          },
        };
      },
    });

    expect(code).toBe(3);
    expect(observedOptions?.selectedCaseIds).toHaveLength(HYDE_EXPECTED_CASE_COUNT);
    expect(observedOptions?.runs).toBe(4);
    expect(observedOptions?.additionalNoncanonicalReasons).toContain(
      'collection output overwrite was forced with --force',
    );
    expect(output.stdout.some((line) => line.includes('[1/1]'))).toBeTrue();
    expect(JSON.parse(await readFile(outputPath, 'utf8')).studyId).toBe('cli-study');
  });

  it('rejects export before adjudication when collection evidence is noncanonical or incomplete', async () => {
    const directory = await tempDirectory();
    const collectionPath = path.join(directory, 'collection.json');
    await writeJson(collectionPath, buildCollectionFixture());
    const output = capture();
    const code = await runHydeEvalCli([
      'export',
      '--collection', collectionPath,
      '--public', path.join(directory, 'public.json'),
      '--private-key', path.join(directory, 'private.json'),
      '--template', path.join(directory, 'template.json'),
    ], output.deps);
    expect(code).toBe(2);
    expect(output.stderr.join('\n')).toContain('Collection canonicality candidate is false');

    const failedSetup = structuredClone(buildExportableCollectionFixture()) as HydeCollectionArtifact;
    failedSetup.canonicality = { candidate: true, reasons: [] };
    const setup = failedSetup.candidateEmbeddingSetups[0];
    failedSetup.candidateEmbeddingSetups[0] = {
      ...setup,
      status: 'failed',
      failure: {
        code: 'embedding_error',
        stage: 'embedding',
        message: 'synthetic setup failure',
        retryable: false,
      },
    };
    await writeJson(collectionPath, failedSetup);
    const setupOutput = capture();
    expect(await runHydeEvalCli([
      'export', '--collection', collectionPath,
      '--public', path.join(directory, 'setup-public.json'),
      '--private-key', path.join(directory, 'setup-private.json'),
      '--template', path.join(directory, 'setup-template.json'),
    ], setupOutput.deps)).toBe(2);
    expect(setupOutput.stderr.join('\n')).toContain('Candidate embedding setup failed for');

    const failedPairs = structuredClone(buildExportableCollectionFixture()) as HydeCollectionArtifact;
    failedPairs.pairedBlocks[0].legacy = {
      status: 'failed',
      failure: {
        code: 'generation_error',
        stage: 'generation',
        message: 'synthetic pair failure',
        retryable: false,
      },
      timing: failedPairs.pairedBlocks[0].legacy.timing,
    };
    await writeJson(collectionPath, failedPairs);
    const pairOutput = capture();
    expect(await runHydeEvalCli([
      'export', '--collection', collectionPath,
      '--public', path.join(directory, 'pair-public.json'),
      '--private-key', path.join(directory, 'pair-private.json'),
      '--template', path.join(directory, 'pair-template.json'),
    ], pairOutput.deps)).toBe(2);
    expect(pairOutput.stderr.join('\n')).toContain('Incomplete paired run');
  });

  it('reports every score/ranking preflight defect and rejects tampered export', async () => {
    const directory = await tempDirectory();
    const collectionPath = path.join(directory, 'tampered-collection.json');
    const collection = structuredClone(buildExportableCollectionFixture()) as HydeCollectionArtifact;
    const slot = collection.pairedBlocks[0].legacy;
    if (slot.status !== 'completed') throw new Error('Expected completed fixture slot');
    const score = slot.result.allCandidateScores[0];
    score.qualified = true;
    score.qualifyingMatchCount = 1;
    score.matchedLensIds = [slot.result.documents.find((document) => document.returned)?.lens ?? 'missing'];
    score.maxCosine = 0.5;
    score.score = 0.49;
    await writeJson(collectionPath, collection);
    const output = capture();
    expect(await runHydeEvalCli([
      'export', '--collection', collectionPath,
      '--public', path.join(directory, 'public.json'),
      '--private-key', path.join(directory, 'private.json'),
      '--template', path.join(directory, 'template.json'),
    ], output.deps)).toBe(2);
    const message = output.stderr.join('\n');
    expect(message).toContain('max cosine does not match retained per-lens cosines');
    expect(message).toContain('score formula mismatch');
    expect(message).toContain('exact stable qualified score subset');

    const mappingTampered = structuredClone(buildExportableCollectionFixture()) as HydeCollectionArtifact;
    mappingTampered.pairedBlocks[0].graphSourceType = mappingTampered.pairedBlocks[0].graphSourceType === 'query' ? 'context' : 'query';
    const mappingPath = path.join(directory, 'mapping-tampered-collection.json');
    await writeJson(mappingPath, mappingTampered);
    const mappingOutput = capture();
    expect(await runHydeEvalCli([
      'export', '--collection', mappingPath,
      '--public', path.join(directory, 'mapping-public.json'),
      '--private-key', path.join(directory, 'mapping-private.json'),
      '--template', path.join(directory, 'mapping-template.json'),
    ], mappingOutput.deps)).toBe(2);
    expect(mappingOutput.stderr.join('\n')).toContain('Internal graph source mapping mismatch');
  });

  it('exports blind artifacts atomically and protects the private key with mode 0600', async () => {
    const directory = await tempDirectory();
    const exported = await exportedFixture(directory);

    expect(JSON.parse(await readFile(exported.publicPath, 'utf8')).artifactType)
      .toBe('hyde-blind-public-batch');
    expect(JSON.parse(await readFile(exported.templatePath, 'utf8')).items).toHaveLength(
      exported.batch.items.length,
    );
    expect((await stat(exported.privatePath)).mode & 0o777).toBe(0o600);
  });

  it('rejects input/output path collisions even when overwrite is forced', async () => {
    const directory = await tempDirectory();
    const collectionPath = path.join(directory, 'collection.json');
    const original = buildExportableCollectionFixture();
    await writeJson(collectionPath, original);
    const output = capture();
    expect(await runHydeEvalCli([
      'export', '--collection', collectionPath,
      '--public', collectionPath,
      '--private-key', path.join(directory, 'private.json'),
      '--template', path.join(directory, 'template.json'),
      '--force',
    ], output.deps)).toBe(2);
    expect(output.stderr.join('\n')).toContain('must not overwrite an input artifact');
    expect(JSON.parse(await readFile(collectionPath, 'utf8')).artifactType).toBe(original.artifactType);
  });

  it('resolves repeated independent judgments, always writes incomplete output, and analyzes it as insufficient', async () => {
    const directory = await tempDirectory();
    const exported = await exportedFixture(directory);
    const judgmentOnePath = path.join(directory, 'human.json');
    const judgmentTwoPath = path.join(directory, 'triage.json');
    const resolvedPath = path.join(directory, 'resolved.json');
    const analysisPath = path.join(directory, 'analysis.json');
    await writeJson(judgmentOnePath, humanJudgment(exported.batch, 'human-one'));
    await writeJson(judgmentTwoPath, buildHydeJudgmentArtifact(exported.batch, {
      adjudicatorId: 'triage-one',
      adjudicatorKind: 'llm-triage',
      blindedIndependentAttestation: true,
      judgments: judgmentsForBatch(exported.batch),
      createdAt: '2026-02-01T00:00:00.000Z',
    }));

    const resolveOutput = capture();
    expect(await runHydeEvalCli([
      'resolve',
      '--batch', exported.publicPath,
      '--judgment', judgmentOnePath,
      '--judgment', judgmentTwoPath,
      '--out', resolvedPath,
    ], resolveOutput.deps)).toBe(3);
    expect(JSON.parse(await readFile(resolvedPath, 'utf8'))).toMatchObject({
      status: 'incomplete',
      canonical: false,
    });

    const analyzeOutput = capture();
    expect(await runHydeEvalCli([
      'analyze',
      '--collection', exported.collectionPath,
      '--private-key', exported.privatePath,
      '--resolved', resolvedPath,
      '--judgment', judgmentOnePath,
      '--judgment', judgmentTwoPath,
      '--out', analysisPath,
    ], analyzeOutput.deps)).toBe(3);
    expect(JSON.parse(await readFile(analysisPath, 'utf8')).gates.overall).toBe('insufficient');
  });

  it('recomputes report evidence from parent artifacts and produces byte-stable output', async () => {
    const directory = await tempDirectory();
    const exported = await exportedFixture(directory);
    const judgmentOnePath = path.join(directory, 'one.json');
    const judgmentTwoPath = path.join(directory, 'two.json');
    const resolvedPath = path.join(directory, 'resolved.json');
    const analysisPath = path.join(directory, 'insufficient-analysis.json');
    await writeJson(judgmentOnePath, humanJudgment(exported.batch, 'human-one'));
    await writeJson(judgmentTwoPath, humanJudgment(exported.batch, 'human-two', [], false));
    await runHydeEvalCli([
      'resolve', '--batch', exported.publicPath,
      '--judgment', judgmentOnePath, '--judgment', judgmentTwoPath,
      '--out', resolvedPath,
    ], capture().deps);
    await runHydeEvalCli([
      'analyze', '--collection', exported.collectionPath,
      '--private-key', exported.privatePath, '--resolved', resolvedPath,
      '--judgment', judgmentOnePath, '--judgment', judgmentTwoPath,
      '--out', analysisPath,
    ], capture().deps);
    const insufficient = parseHydeAnalysisArtifact(
      JSON.parse(await readFile(analysisPath, 'utf8')) as unknown,
    );
    const parentArgs = [
      '--collection', exported.collectionPath,
      '--private-key', exported.privatePath,
      '--resolved', resolvedPath,
      '--judgment', judgmentOnePath,
      '--judgment', judgmentTwoPath,
    ];
    const tamperedPath = path.join(directory, 'tampered-pass.json');
    await writeJson(tamperedPath, withGateStatus(insufficient, 'pass'));
    const tamperedOutput = capture();
    expect(await runHydeEvalCli([
      'report', '--analysis', tamperedPath, ...parentArgs,
      '--json', path.join(directory, 'tampered-report.json'),
    ], tamperedOutput.deps)).toBe(2);
    expect(tamperedOutput.stderr.join('\n')).toContain('does not match recomputation');

    const jsonOne = path.join(directory, 'insufficient-one.json');
    const jsonTwo = path.join(directory, 'insufficient-two.json');
    const markdownPath = path.join(directory, 'insufficient.md');
    expect(await runHydeEvalCli([
      'report', '--analysis', analysisPath, ...parentArgs,
      '--json', jsonOne, '--markdown', markdownPath,
    ], capture().deps)).toBe(3);
    expect(await runHydeEvalCli([
      'report', '--analysis', analysisPath, ...parentArgs, '--json', jsonTwo,
    ], capture().deps)).toBe(3);
    expect(await readFile(jsonOne, 'utf8')).toBe(await readFile(jsonTwo, 'utf8'));
    expect((await readFile(markdownPath, 'utf8')).startsWith('# INSUFFICIENT')).toBeTrue();
  });

  it('refuses overwrites unless forced and reports malformed JSON with its path', async () => {
    const directory = await tempDirectory();
    const malformedPath = path.join(directory, 'malformed.json');
    const outputPath = path.join(directory, 'report.json');
    await writeFile(malformedPath, '{not json', 'utf8');
    await writeFile(outputPath, 'existing', 'utf8');

    const malformed = capture();
    expect(await runHydeEvalCli([
      'report', '--analysis', malformedPath,
      '--collection', '/tmp/collection', '--private-key', '/tmp/private', '--resolved', '/tmp/resolved',
      '--judgment', '/tmp/one', '--judgment', '/tmp/two',
      '--json', path.join(directory, 'unused.json'),
    ], malformed.deps)).toBe(2);
    expect(malformed.stderr.join('\n')).toContain(`Malformed JSON at ${malformedPath}`);

    const insufficientPath = path.join(directory, 'analysis.json');
    const exported = await exportedFixture(path.join(directory, 'exported'));
    const judgmentOnePath = path.join(directory, 'one.json');
    const judgmentTwoPath = path.join(directory, 'two.json');
    const resolvedPath = path.join(directory, 'resolved.json');
    await writeJson(judgmentOnePath, humanJudgment(exported.batch, 'one'));
    await writeJson(judgmentTwoPath, humanJudgment(exported.batch, 'two', [], false));
    await runHydeEvalCli([
      'resolve', '--batch', exported.publicPath,
      '--judgment', judgmentOnePath, '--judgment', judgmentTwoPath,
      '--out', resolvedPath,
    ], capture().deps);
    await runHydeEvalCli([
      'analyze', '--collection', exported.collectionPath,
      '--private-key', exported.privatePath, '--resolved', resolvedPath,
      '--judgment', judgmentOnePath, '--judgment', judgmentTwoPath,
      '--out', insufficientPath,
    ], capture().deps);

    const reportParentArgs = [
      '--collection', exported.collectionPath,
      '--private-key', exported.privatePath,
      '--resolved', resolvedPath,
      '--judgment', judgmentOnePath,
      '--judgment', judgmentTwoPath,
    ];
    const refused = capture();
    expect(await runHydeEvalCli([
      'report', '--analysis', insufficientPath, ...reportParentArgs, '--json', outputPath,
    ], refused.deps)).toBe(2);
    expect(refused.stderr.join('\n')).toContain('Refusing to overwrite');
    expect(await readFile(outputPath, 'utf8')).toBe('existing');

    expect(await runHydeEvalCli([
      'report', '--analysis', insufficientPath, ...reportParentArgs,
      '--json', outputPath, '--force',
    ], capture().deps)).toBe(3);
    expect(JSON.parse(await readFile(outputPath, 'utf8')).artifactType).toBe('hyde-evidence-analysis');
  });
});
