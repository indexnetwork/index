import { createHash } from 'node:crypto';

import { describe, expect, it } from 'bun:test';

import { buildHydeJudgmentArtifact, resolveAdjudications } from '../hyde.adjudication.js';
import { analyzeHydeEvidence } from '../hyde.analysis.js';
import { buildBlindExport, fingerprintHydeArtifact, parseHydeAnalysisArtifact, parseHydeBlindPrivateKey } from '../hyde.artifacts.js';
import { HYDE_CASES, HYDE_CORPUS_FINGERPRINT } from '../hyde.cases.js';
import { HYDE_ARTIFACT_SCHEMA_VERSION, HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING, HYDE_BOOTSTRAP_SEED, HYDE_CANONICAL_EMBEDDING_PIN, HYDE_CANONICAL_FRAME_GENERATION_VERSION, HYDE_CANONICAL_MODEL_PINS, HYDE_CANONICAL_PROVENANCE_PINS, HYDE_CANONICAL_RUNS, HYDE_CORPUS_VERSION, HYDE_EXECUTION_SEED, HYDE_EXPECTED_CANDIDATE_COUNT, HYDE_EXPECTED_PAIR_COUNT, HYDE_EXPECTED_SOURCE_CASE_COUNTS, HYDE_EXPECTED_SOURCE_PAIR_COUNTS, HYDE_GATE_POLICY_VERSION, HYDE_LENS_BONUS, HYDE_MAX_LENSES, HYDE_MIN_CASES_PER_STRATUM, HYDE_MIN_SCORE, HYDE_RUBRIC_VERSION } from '../hyde.policy.js';
import { buildHydeEvidenceReport, renderHydeEvidenceMarkdown } from '../hyde.report.js';
import { HYDE_COLLECTION_ARTIFACT_TYPE, HydeCollectionArtifactSchema, HydeResolvedAdjudicationArtifactSchema, type HydeBlindPrivateKey, type HydeCollectionArtifact, type HydeResolvedAdjudicationArtifact } from '../hyde.schemas.js';
import { HYDE_EVAL_STRATA, type GeneratedDocumentDiagnostic, type HydeEvalCase, type RelevanceGrade } from '../hyde.types.js';

const GENERATED_AT = '2026-02-01T00:00:00.000Z';
const MACRO_SINGLE_EVENT_DENOMINATOR = HYDE_EVAL_STRATA.length * HYDE_MIN_CASES_PER_STRATUM * HYDE_CANONICAL_RUNS;
const TIMING = {
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:00.010Z',
  durationMs: 10,
} as const;

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function caseRunHash(caseId: string, run: number): string {
  return createHash('sha256')
    .update(String(HYDE_EXECUTION_SEED))
    .update('\0')
    .update(caseId)
    .update('\0')
    .update(String(run))
    .digest('hex');
}

function schedule() {
  return HYDE_CASES.flatMap((c) => {
    const perCase = Array.from({ length: HYDE_CANONICAL_RUNS }, (_, index) => ({
      caseId: c.id,
      run: index + 1,
      hash: caseRunHash(c.id, index + 1),
    })).sort((left, right) => compareAscii(left.hash, right.hash) || left.run - right.run);
    return perCase.map((entry, index) => ({
      ...entry,
      modeOrder: index < HYDE_CANONICAL_RUNS / 2
        ? ['legacy', 'frame-v1'] as const
        : ['frame-v1', 'legacy'] as const,
    }));
  }).sort((left, right) => compareAscii(left.hash, right.hash)
    || compareAscii(left.caseId, right.caseId)
    || left.run - right.run)
    .map((entry, executionOrdinal) => ({ ...entry, executionOrdinal }));
}

function defaultDocument(mode: 'legacy' | 'frame-v1'): GeneratedDocumentDiagnostic {
  return mode === 'legacy'
    ? {
      lens: 'legacy-lens',
      corpus: 'intents',
      text: 'Legacy synthetic generated document.',
      mapStatus: 'submitted',
      validationStatus: 'not_applicable',
      returned: true,
    }
    : {
      lens: 'frame-lens',
      corpus: 'intents',
      text: 'Frame synthetic generated document.',
      mapStatus: 'submitted',
      validationStatus: 'valid',
      validatorKey: 'frame-key',
      returned: true,
      verdict: {
        key: 'frame-key',
        valid: true,
        unsupportedNamedEntities: [],
        unsupportedHardConstraints: [],
        reasoning: 'Production validator diagnostic only.',
      },
    };
}

function result(
  c: HydeEvalCase,
  run: number,
  mode: 'legacy' | 'frame-v1',
  documents: GeneratedDocumentDiagnostic[] = [defaultDocument(mode)],
) {
  const returnedLens = documents.find((document) => document.returned)?.lens;
  const allCandidateScores = c.candidates.map((candidate, index) => ({
    candidateId: candidate.id,
    role: candidate.role,
    relevanceGrade: candidate.relevanceGrade,
    corpus: candidate.corpus,
    ...(candidate.hardNegativeOf ? { hardNegativeOf: candidate.hardNegativeOf } : {}),
    score: returnedLens ? 0.9 - index / 100 : 0,
    lensMatches: returnedLens ? [{ lensId: returnedLens, cosine: 0.9 - index / 100 }] : [],
    maxCosine: returnedLens ? 0.9 - index / 100 : 0,
    qualifyingMatchCount: returnedLens ? 1 : 0,
    matchedLensIds: returnedLens ? [returnedLens] : [],
    qualified: returnedLens !== undefined,
  }));
  const validatorSubmittedDocumentCount = mode === 'frame-v1'
    ? documents.filter((document) => document.mapStatus === 'submitted'
      && document.validationStatus !== 'not_submitted').length
    : 0;
  const rejectedCount = mode === 'frame-v1'
    ? documents.filter((document) => document.validationStatus === 'invalid').length
    : null;
  return {
    caseId: c.id,
    mode,
    run,
    allCandidateScores,
    ranking: allCandidateScores.filter((candidate) => candidate.qualified)
      .sort((left, right) => right.score - left.score),
    lensCount: documents.length,
    returnedDocumentCount: documents.filter((document) => document.returned).length,
    generatedDocumentCount: documents.length,
    overwrittenDocumentCount: documents.filter((document) => document.mapStatus === 'overwritten').length,
    validatorSubmittedDocumentCount,
    rejectedCount,
    failedOpenCount: documents.filter((document) => document.validationStatus === 'failed_open').length,
    documents,
    resources: {
      lensInferenceCalls: [{ durationMs: 1, inputCount: 1, outcome: 'completed' as const }],
      generatorCalls: documents.map(() => ({ durationMs: 2, inputCount: 1, outcome: 'completed' as const })),
      validatorCalls: mode === 'frame-v1' && validatorSubmittedDocumentCount > 0
        ? [{ durationMs: 3, inputCount: validatorSubmittedDocumentCount, outcome: 'completed' as const }]
        : [],
      documentEmbeddingCalls: documents.some((document) => document.returned)
        ? [{ durationMs: 1, inputCount: documents.filter((document) => document.returned).length, outcome: 'completed' as const }]
        : [],
    },
  };
}

function buildCanonicalCollection(
  customize?: (input: { caseIndex: number; run: number; mode: 'legacy' | 'frame-v1' }) => GeneratedDocumentDiagnostic[] | undefined,
): HydeCollectionArtifact {
  const byId = new Map(HYDE_CASES.map((c) => [c.id, c]));
  const canonicalSchedule = schedule();
  const pairedBlocks = canonicalSchedule.map((entry) => {
    const c = byId.get(entry.caseId);
    if (!c) throw new Error('Unknown synthetic case');
    const caseIndex = HYDE_CASES.findIndex((candidate) => candidate.id === c.id);
    const legacyDocuments = customize?.({ caseIndex, run: entry.run, mode: 'legacy' });
    const frameDocuments = customize?.({ caseIndex, run: entry.run, mode: 'frame-v1' });
    return {
      caseId: c.id,
      stratum: c.stratum,
      backgroundSource: c.backgroundSource,
      graphSourceType: HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING[c.backgroundSource],
      run: entry.run,
      executionOrdinal: entry.executionOrdinal,
      modeOrder: entry.modeOrder,
      legacy: { status: 'completed' as const, result: result(c, entry.run, 'legacy', legacyDocuments), timing: TIMING },
      frameV1: { status: 'completed' as const, result: result(c, entry.run, 'frame-v1', frameDocuments), timing: TIMING },
    };
  });
  const config = {
    selectedCaseIds: HYDE_CASES.map((c) => c.id),
    runs: HYDE_CANONICAL_RUNS,
    cutoff: HYDE_MIN_SCORE,
    lensBonus: HYDE_LENS_BONUS,
    maxLenses: HYDE_MAX_LENSES,
    seeds: { execution: HYDE_EXECUTION_SEED, bootstrap: HYDE_BOOTSTRAP_SEED },
  };
  const models = HYDE_CANONICAL_MODEL_PINS;
  const embedding = HYDE_CANONICAL_EMBEDDING_PIN;
  const generationVersion = HYDE_CANONICAL_FRAME_GENERATION_VERSION;
  const configFingerprint = fingerprintHydeArtifact({
    policyVersion: HYDE_GATE_POLICY_VERSION,
    config,
    policyPins: HYDE_CANONICAL_PROVENANCE_PINS,
    models,
    embedding,
    generationVersion,
    backgroundSourceGraphMapping: [
      { backgroundSource: 'saved-intent', graphSourceType: 'query' },
      { backgroundSource: 'user-context', graphSourceType: 'context' },
    ],
    schedule: canonicalSchedule.map(({ caseId, run, hash, modeOrder }) => ({ caseId, run, hash, modeOrder })),
  });
  return HydeCollectionArtifactSchema.parse({
    artifactType: HYDE_COLLECTION_ARTIFACT_TYPE,
    schemaVersion: HYDE_ARTIFACT_SCHEMA_VERSION,
    policyVersion: HYDE_GATE_POLICY_VERSION,
    corpusVersion: HYDE_CORPUS_VERSION,
    rubricVersion: HYDE_RUBRIC_VERSION,
    studyId: 'canonical-synthetic-study',
    createdAt: '2026-01-01T00:00:01.000Z',
    corpusFingerprint: HYDE_CORPUS_FINGERPRINT,
    configFingerprint,
    provenance: {
      git: { revision: 'a'.repeat(40), dirty: false, revisionWithDirtyMarker: 'a'.repeat(40) },
      models,
      embedding,
      generationVersion,
      backgroundSourceGraphMapping: [
        { backgroundSource: 'saved-intent', graphSourceType: 'query' },
        { backgroundSource: 'user-context', graphSourceType: 'context' },
      ],
    },
    canonicality: { candidate: true, reasons: [] },
    config,
    candidateEmbeddingSetups: HYDE_CASES.map((c) => ({
      caseId: c.id,
      status: 'completed' as const,
      ...TIMING,
      inputCount: c.candidates.length,
      candidatePoolFingerprint: fingerprintHydeArtifact(c.candidates),
    })),
    pairedBlocks,
  });
}

function canonicalGrades(): Map<string, RelevanceGrade> {
  return new Map(HYDE_CASES.flatMap((c) => c.candidates.map((candidate) => [candidate.id, candidate.relevanceGrade] as const)));
}

function buildResolution(
  collection: HydeCollectionArtifact,
  privateKey: HydeBlindPrivateKey,
  publicBatch: ReturnType<typeof buildBlindExport>['publicBatch'],
  grades: ReadonlyMap<string, RelevanceGrade> = canonicalGrades(),
  unsupportedDocumentKeys: ReadonlySet<string> = new Set(),
) {
  const mappingById = new Map(privateKey.mappings.map((mapping) => [mapping.opaqueId, mapping]));
  const judgments = publicBatch.items.map((item) => {
    const mapping = mappingById.get(item.opaqueId);
    if (!mapping || mapping.taskKind !== item.taskKind) throw new Error('Missing synthetic private mapping');
    if (mapping.taskKind === 'candidate-relevance') {
      return { opaqueId: item.opaqueId, taskKind: mapping.taskKind, relevanceGrade: grades.get(mapping.candidateId) ?? 0 } as const;
    }
    const key = `${mapping.caseId}\0${mapping.run}\0${mapping.mode}\0${mapping.documentIndex}`;
    const unsupported = unsupportedDocumentKeys.has(key);
    return {
      opaqueId: item.opaqueId,
      taskKind: mapping.taskKind,
      grounding: unsupported ? 'unsupported' as const : 'supported' as const,
      unsupportedAdditions: unsupported ? [{
        category: 'other' as const,
        excerpts: ['synthetic unsupported detail'],
        rationale: 'Absent from the source.',
      }] : [],
    };
  });
  const humanOne = buildHydeJudgmentArtifact(publicBatch, {
    adjudicatorId: 'human-one',
    adjudicatorKind: 'human',
    blindedIndependentAttestation: true,
    judgments,
    createdAt: '2026-01-02T00:00:00.000Z',
  });
  const humanTwo = buildHydeJudgmentArtifact(publicBatch, {
    adjudicatorId: 'human-two',
    adjudicatorKind: 'human',
    blindedIndependentAttestation: true,
    judgments,
    createdAt: '2026-01-02T00:00:00.000Z',
  });
  const sourceJudgments = [humanOne, humanTwo];
  return {
    judgments: sourceJudgments,
    resolved: resolveAdjudications(publicBatch, sourceJudgments, undefined, {
      createdAt: '2026-01-03T00:00:00.000Z',
    }),
  };
}

function bundle(
  collection = buildCanonicalCollection(),
  grades: ReadonlyMap<string, RelevanceGrade> = canonicalGrades(),
  unsupported: ReadonlySet<string> = new Set(),
) {
  const { privateKey, publicBatch } = buildBlindExport(collection, HYDE_CASES, {
    secret: 'analysis-test-hmac-secret',
    createdAt: '2026-01-02T00:00:00.000Z',
  });
  const resolution = buildResolution(collection, privateKey, publicBatch, grades, unsupported);
  return { collection, privateKey, ...resolution };
}

function analyze(input: ReturnType<typeof bundle>) {
  return analyzeHydeEvidence(input.collection, input.privateKey, input.resolved, HYDE_CASES, {
    generatedAt: GENERATED_AT,
    bootstrapReplicates: 20,
    judgmentArtifacts: input.judgments,
  });
}

function firstReasonIncludes(analysis: ReturnType<typeof analyze>, text: string): boolean {
  return analysis.canonicality.reasons.some((reason) => reason.includes(text));
}

describe('canonical HyDE evidence analysis', () => {
  it('uses resolved human grades deterministically while making a 20-replicate analysis explicitly insufficient', () => {
    const grades = canonicalGrades();
    const firstCase = HYDE_CASES[0];
    const authoredThree = firstCase.candidates.find((candidate) => candidate.relevanceGrade === 3);
    const authoredOtherPositive = firstCase.candidates.find((candidate) => candidate.relevanceGrade > 0 && candidate.id !== authoredThree?.id);
    if (!authoredThree || !authoredOtherPositive) throw new Error('Expected two positives');
    grades.set(authoredThree.id, 2);
    grades.set(authoredOtherPositive.id, 3);
    const collection = buildCanonicalCollection();
    const input = bundle(collection, grades);
    const first = analyze(input);
    const second = analyze(input);
    const authorLabelAnalysis = analyze(bundle(collection));

    expect(first).toEqual(second);
    expect(first.canonicality.status).toBe('insufficient');
    expect(first.canonicality.reasons).toContain('Bootstrap replicate count 20 differs from canonical 10000');
    expect(first.completeness).toMatchObject({
      expectedPairCount: HYDE_EXPECTED_PAIR_COUNT,
      completedPairCount: HYDE_EXPECTED_PAIR_COUNT,
      incompletePairCount: 0,
      incompletePairRate: 0,
      candidateMappingCount: HYDE_EXPECTED_CANDIDATE_COUNT,
    });
    expect(first.sourceCoverage).toEqual([
      { backgroundSource: 'saved-intent', expectedCaseCount: HYDE_EXPECTED_SOURCE_CASE_COUNTS['saved-intent'], caseCount: HYDE_EXPECTED_SOURCE_CASE_COUNTS['saved-intent'], expectedPairCount: HYDE_EXPECTED_SOURCE_PAIR_COUNTS['saved-intent'], observedPairCount: HYDE_EXPECTED_SOURCE_PAIR_COUNTS['saved-intent'], completedPairCount: HYDE_EXPECTED_SOURCE_PAIR_COUNTS['saved-intent'] },
      { backgroundSource: 'user-context', expectedCaseCount: HYDE_EXPECTED_SOURCE_CASE_COUNTS['user-context'], caseCount: HYDE_EXPECTED_SOURCE_CASE_COUNTS['user-context'], expectedPairCount: HYDE_EXPECTED_SOURCE_PAIR_COUNTS['user-context'], observedPairCount: HYDE_EXPECTED_SOURCE_PAIR_COUNTS['user-context'], completedPairCount: HYDE_EXPECTED_SOURCE_PAIR_COUNTS['user-context'] },
    ]);
    expect(first.perBackgroundSource.map((source) => source.backgroundSource)).toEqual(['saved-intent', 'user-context']);
    expect(first.perBackgroundSource.every((source) => Object.values(source.metrics).every((metric) => metric.available))).toBeTrue();
    expect(first.metrics.ndcgAt5.available).toBeTrue();
    expect(authorLabelAnalysis.metrics.ndcgAt5.available).toBeTrue();
    if (!first.metrics.ndcgAt5.available || !authorLabelAnalysis.metrics.ndcgAt5.available) {
      throw new Error('Expected available nDCG metrics');
    }
    expect(first.metrics.ndcgAt5.pointEstimate.legacy)
      .not.toBe(authorLabelAnalysis.metrics.ndcgAt5.pointEstimate.legacy);
    expect(first.gates.overall).toBe('insufficient');
    expect(first.gates.records.every((record) => record.status === 'insufficient')).toBeTrue();
  });

  it('validates provenance against committed pins independent of current process env', () => {
    const input = bundle();
    const baseline = analyze(input);
    const previousModel = process.env.EMBEDDING_MODEL;
    const previousDimensions = process.env.EMBEDDING_DIMENSIONS;
    process.env.EMBEDDING_MODEL = 'test/other-embedding';
    process.env.EMBEDDING_DIMENSIONS = '17';
    try {
      const underDriftedEnv = analyze(input);
      expect(underDriftedEnv).toEqual(baseline);
      expect(underDriftedEnv.canonicality.status).toBe('insufficient');
      expect(underDriftedEnv.canonicality.reasons).toContain('Bootstrap replicate count 20 differs from canonical 10000');
    } finally {
      if (previousModel === undefined) delete process.env.EMBEDDING_MODEL;
      else process.env.EMBEDDING_MODEL = previousModel;
      if (previousDimensions === undefined) delete process.env.EMBEDDING_DIMENSIONS;
      else process.env.EMBEDDING_DIMENSIONS = previousDimensions;
    }
  });

  it('derives generatedAt deterministically from the resolved parent by default', () => {
    const input = bundle();
    const analysis = analyzeHydeEvidence(input.collection, input.privateKey, input.resolved, HYDE_CASES, {
      bootstrapReplicates: 20,
      judgmentArtifacts: input.judgments,
    });
    expect(analysis.generatedAt).toBe(input.resolved.createdAt);
    expect(JSON.stringify(analysis)).toBe(JSON.stringify(analyzeHydeEvidence(
      input.collection,
      input.privateKey,
      input.resolved,
      HYDE_CASES,
      { bootstrapReplicates: 20, judgmentArtifacts: input.judgments },
    )));
  });

  it('counts overwritten/rejected/failed-open/no-return/no-generation semantics canonically', () => {
    const collection = buildCanonicalCollection(({ caseIndex, run, mode }) => {
      if (caseIndex !== 0) return undefined;
      if (run === 1 && mode === 'legacy') return [
        { ...defaultDocument('legacy'), text: 'unsupported overwritten', mapStatus: 'overwritten', returned: false },
        { ...defaultDocument('legacy'), text: 'supported returned', returned: true },
      ];
      if (run === 1 && mode === 'frame-v1') return [
        { ...defaultDocument('frame-v1'), text: 'unsupported rejected', validationStatus: 'invalid', returned: false, verdict: { key: 'frame-key', valid: false, unsupportedNamedEntities: [], unsupportedHardConstraints: [], reasoning: 'diagnostic' } },
        { ...defaultDocument('frame-v1'), text: 'unsupported failed open', validationStatus: 'failed_open', failedOpenReason: 'validator_error', returned: true },
      ];
      if (run === 2 && mode === 'frame-v1') return [
        { ...defaultDocument('frame-v1'), text: 'supported all rejected', validationStatus: 'invalid', returned: false, verdict: { key: 'frame-key', valid: false, unsupportedNamedEntities: [], unsupportedHardConstraints: [], reasoning: 'diagnostic' } },
      ];
      if (run === 3 && mode === 'frame-v1') return [];
      return undefined;
    });
    const exported = buildBlindExport(collection, HYDE_CASES, { secret: 'analysis-test-hmac-secret', createdAt: '2026-01-02T00:00:00.000Z' });
    const unsupported = new Set<string>();
    for (const mapping of exported.privateKey.mappings) {
      if (mapping.taskKind !== 'generated-document-grounding') continue;
      const block = collection.pairedBlocks.find((candidate) => candidate.caseId === mapping.caseId && candidate.run === mapping.run);
      const slot = mapping.mode === 'legacy' ? block?.legacy : block?.frameV1;
      if (slot?.status !== 'completed') continue;
      const text = slot.result.documents[mapping.documentIndex]?.text;
      if (text?.startsWith('unsupported')) unsupported.add(`${mapping.caseId}\0${mapping.run}\0${mapping.mode}\0${mapping.documentIndex}`);
    }
    const resolution = buildResolution(
      collection,
      exported.privateKey,
      exported.publicBatch,
      canonicalGrades(),
      unsupported,
    );
    const analysis = analyze({
      collection,
      privateKey: exported.privateKey,
      ...resolution,
    });

    expect(analysis.canonicality.status).toBe('insufficient');
    expect(firstReasonIncludes(analysis, 'Bootstrap replicate count 20')).toBeTrue();
    expect(analysis.metrics.unsupportedAdditionRate.available).toBeTrue();
    expect(analysis.metrics.groundingErrorRate.available).toBeTrue();
    if (!analysis.metrics.unsupportedAdditionRate.available || !analysis.metrics.groundingErrorRate.available
      || !analysis.metrics.frameAllRejectedRate.available || !analysis.metrics.frameFailedOpenRate.available) {
      throw new Error('Expected available metrics');
    }
    expect(analysis.metrics.unsupportedAdditionRate.pointEstimate.legacy).toBeCloseTo(1 / (MACRO_SINGLE_EVENT_DENOMINATOR * 2), 12);
    expect(analysis.metrics.unsupportedAdditionRate.pointEstimate.frameV1).toBeCloseTo(1 / MACRO_SINGLE_EVENT_DENOMINATOR, 12);
    expect(analysis.metrics.groundingErrorRate.pointEstimate.legacy).toBe(0);
    expect(analysis.metrics.groundingErrorRate.pointEstimate.frameV1).toBeCloseTo(1 / MACRO_SINGLE_EVENT_DENOMINATOR, 12);
    expect(analysis.metrics.frameAllRejectedRate.pointEstimate).toBeCloseTo(1 / MACRO_SINGLE_EVENT_DENOMINATOR, 12);
    expect(analysis.metrics.frameFailedOpenRate.pointEstimate).toBeCloseTo(1 / (MACRO_SINGLE_EVENT_DENOMINATOR * 2), 12);
    const frameResources = analysis.resources.modeRuns.find((entry) => entry.mode === 'frame-v1');
    expect(frameResources).toMatchObject({
      emptyGenerationRunCount: 1,
      overwrittenDocumentCount: 0,
      rejectedDocumentCount: 2,
      failedOpenDocumentCount: 1,
      allRejectedRunCount: 1,
    });
    expect(analysis.resources.modeRuns.find((entry) => entry.mode === 'legacy')?.overwrittenDocumentCount).toBe(1);
  });

  it('rejects internally inconsistent candidate scores and ranking edits', () => {
    const outOfRange = structuredClone(buildCanonicalCollection()) as HydeCollectionArtifact;
    const outOfRangeSlot = outOfRange.pairedBlocks[0].legacy;
    if (outOfRangeSlot.status !== 'completed') throw new Error('Expected completed synthetic slot');
    outOfRangeSlot.result.allCandidateScores[0].maxCosine = 2;
    expect(() => HydeCollectionArtifactSchema.parse(outOfRange)).toThrow();

    const scoreTampered = structuredClone(buildCanonicalCollection()) as HydeCollectionArtifact;
    const scoreSlot = scoreTampered.pairedBlocks[0].legacy;
    if (scoreSlot.status !== 'completed') throw new Error('Expected completed synthetic slot');
    scoreSlot.result.allCandidateScores[0].score -= 0.01;
    const scoreAnalysis = analyze(bundle(HydeCollectionArtifactSchema.parse(scoreTampered)));
    expect(firstReasonIncludes(scoreAnalysis, 'score formula mismatch')).toBeTrue();
    expect(scoreAnalysis.gates.overall).toBe('insufficient');

    const rankingTampered = structuredClone(buildCanonicalCollection()) as HydeCollectionArtifact;
    const rankingSlot = rankingTampered.pairedBlocks[0].frameV1;
    if (rankingSlot.status !== 'completed') throw new Error('Expected completed synthetic slot');
    [rankingSlot.result.ranking[0], rankingSlot.result.ranking[1]] = [
      rankingSlot.result.ranking[1],
      rankingSlot.result.ranking[0],
    ];
    const rankingAnalysis = analyze(bundle(HydeCollectionArtifactSchema.parse(rankingTampered)));
    expect(firstReasonIncludes(rankingAnalysis, 'exact stable qualified score subset')).toBeTrue();
    expect(rankingAnalysis.gates.overall).toBe('insufficient');

    const orderTampered = structuredClone(buildCanonicalCollection()) as HydeCollectionArtifact;
    const orderSlot = orderTampered.pairedBlocks[0].legacy;
    if (orderSlot.status !== 'completed') throw new Error('Expected completed synthetic slot');
    [orderSlot.result.allCandidateScores[0], orderSlot.result.allCandidateScores[1]] = [
      orderSlot.result.allCandidateScores[1],
      orderSlot.result.allCandidateScores[0],
    ];
    const orderAnalysis = analyze(bundle(HydeCollectionArtifactSchema.parse(orderTampered)));
    expect(firstReasonIncludes(orderAnalysis, 'exact authored order')).toBeTrue();

    const lensTampered = structuredClone(buildCanonicalCollection()) as HydeCollectionArtifact;
    const lensSlot = lensTampered.pairedBlocks[0].frameV1;
    if (lensSlot.status !== 'completed') throw new Error('Expected completed synthetic slot');
    const lensScore = lensSlot.result.allCandidateScores[0];
    lensScore.qualifyingMatchCount = 2;
    lensScore.matchedLensIds = [lensScore.matchedLensIds[0], lensScore.matchedLensIds[0]];
    lensScore.score = Math.min(lensScore.maxCosine + HYDE_LENS_BONUS, 1);
    const lensAnalysis = analyze(bundle(HydeCollectionArtifactSchema.parse(lensTampered)));
    expect(firstReasonIncludes(lensAnalysis, 'matched-lens IDs do not match retained per-lens cosines')).toBeTrue();
    expect(firstReasonIncludes(lensAnalysis, 'exceeds available lenses/documents')).toBeTrue();

    const unknownLens = structuredClone(buildCanonicalCollection()) as HydeCollectionArtifact;
    const unknownLensSlot = unknownLens.pairedBlocks[0].legacy;
    if (unknownLensSlot.status !== 'completed') throw new Error('Expected completed synthetic slot');
    unknownLensSlot.result.allCandidateScores[0].matchedLensIds = ['not-a-returned-document'];
    const unknownLensAnalysis = analyze(bundle(HydeCollectionArtifactSchema.parse(unknownLens)));
    expect(firstReasonIncludes(unknownLensAnalysis, 'matched-lens IDs do not match retained per-lens cosines')).toBeTrue();

    const duplicateRanking = structuredClone(buildCanonicalCollection()) as HydeCollectionArtifact;
    const duplicateRankingSlot = duplicateRanking.pairedBlocks[0].legacy;
    if (duplicateRankingSlot.status !== 'completed') throw new Error('Expected completed synthetic slot');
    duplicateRankingSlot.result.ranking[1] = duplicateRankingSlot.result.ranking[0];
    const duplicateRankingAnalysis = analyze(bundle(HydeCollectionArtifactSchema.parse(duplicateRanking)));
    expect(firstReasonIncludes(duplicateRankingAnalysis, 'Ranking candidate IDs are not unique')).toBeTrue();

    const generationTampered = structuredClone(buildCanonicalCollection()) as HydeCollectionArtifact;
    const generationSlot = generationTampered.pairedBlocks[0].frameV1;
    if (generationSlot.status !== 'completed') throw new Error('Expected completed synthetic slot');
    generationSlot.result.resources.generatorCalls.pop();
    const generationAnalysis = analyze(bundle(HydeCollectionArtifactSchema.parse(generationTampered)));
    expect(firstReasonIncludes(generationAnalysis, 'Generator resource/diagnostic count mismatch')).toBeTrue();
  }, 30_000);

  it('requires original judgment parents and revalidates resolved content rather than trusting provenance', () => {
    const complete = bundle();
    const missingSources = analyzeHydeEvidence(
      complete.collection,
      complete.privateKey,
      complete.resolved,
      HYDE_CASES,
      { bootstrapReplicates: 20 },
    );
    expect(missingSources.gates.overall).toBe('insufficient');
    expect(missingSources.canonicality.reasons.some((reason) =>
      reason.includes('Original independent judgment artifacts'))).toBeTrue();

    const selfAsserted = structuredClone(complete.resolved) as HydeResolvedAdjudicationArtifact;
    selfAsserted.sourceProvenance.judgmentArtifacts[0].fingerprint = 'f'.repeat(64);
    const mismatch = analyze({
      ...complete,
      resolved: HydeResolvedAdjudicationArtifactSchema.parse(selfAsserted),
    });
    expect(firstReasonIncludes(mismatch, 'does not exactly match recomputation')).toBeTrue();
  });

  it('makes failed slots and missing canonical case/run coverage explicitly insufficient', () => {
    const input = bundle();
    const failed = structuredClone(input.collection) as HydeCollectionArtifact;
    const block = failed.pairedBlocks[0];
    block.frameV1 = {
      status: 'failed',
      failure: { code: 'generation_error', stage: 'generation', message: 'synthetic failure', retryable: false },
      timing: TIMING,
      resources: {
        lensInferenceCalls: [{ durationMs: 2, inputCount: 1, outcome: 'completed' }],
        generatorCalls: [{ durationMs: 3, inputCount: 1, outcome: 'threw' }],
        validatorCalls: [],
        documentEmbeddingCalls: [],
      },
    };
    const failedInput = {
      ...input,
      collection: HydeCollectionArtifactSchema.parse(failed),
    };
    const analysis = analyze(failedInput);
    expect(analysis.gates.overall).toBe('insufficient');
    expect(analysis.gates.records.every((gate) => gate.status === 'insufficient')).toBeTrue();
    expect(analysis.completeness).toMatchObject({ failedPairCount: 1, incompletePairCount: 1, incompletePairRate: 1 / HYDE_EXPECTED_PAIR_COUNT });
    expect(firstReasonIncludes(analysis, 'Incomplete paired run')).toBeTrue();
    expect(analysis.metrics.precisionAt5).toMatchObject({ available: false });
    expect(analysis.resources.productionWrapperCalls.generator.outcomes.threw).toBe(1);
  });

  it('makes missing mappings and missing judgments explicit', () => {
    const complete = bundle();
    const missingMappingKey = parseHydeBlindPrivateKey({
      ...complete.privateKey,
      mappings: complete.privateKey.mappings.slice(1),
    });
    const mappingAnalysis = analyze({
      ...complete,
      privateKey: missingMappingKey,
    });
    expect(mappingAnalysis.gates.overall).toBe('insufficient');
    expect(firstReasonIncludes(mappingAnalysis, 'mappings')).toBeTrue();

    const missingJudgment = structuredClone(complete.resolved) as HydeResolvedAdjudicationArtifact;
    missingJudgment.items.pop();
    missingJudgment.coverage.publicItemCount -= 1;
    missingJudgment.counts.resolved -= 1;
    missingJudgment.counts.agreement -= 1;
    const judgmentAnalysis = analyze({
      ...complete,
      resolved: HydeResolvedAdjudicationArtifactSchema.parse(missingJudgment),
    });
    expect(judgmentAnalysis.gates.overall).toBe('insufficient');
    expect(firstReasonIncludes(judgmentAnalysis, 'judgments do not exactly cover')).toBeTrue();
  });

  it('rejects noncanonical LLM-only resolution, parent mismatch, and invalid resolved grade shape', () => {
    const complete = bundle();
    const llmOnly = structuredClone(complete.resolved) as HydeResolvedAdjudicationArtifact;
    llmOnly.canonical = false;
    llmOnly.reasons = ['Only LLM triage was available'];
    llmOnly.coverage.completeAttestedHumanAdjudicatorCount = 0;
    llmOnly.coverage.submittedHumanArtifactCount = 0;
    llmOnly.coverage.triageArtifactCount = 1;
    llmOnly.coverage.completeTriageArtifactCount = 1;
    const llmAnalysis = analyze({ ...complete, resolved: HydeResolvedAdjudicationArtifactSchema.parse(llmOnly) });
    expect(llmAnalysis.gates.overall).toBe('insufficient');
    expect(firstReasonIncludes(llmAnalysis, 'Fewer than two')).toBeTrue();

    const wrongParent = parseHydeBlindPrivateKey({ ...complete.privateKey, configFingerprint: 'f'.repeat(64) });
    const parentAnalysis = analyze({ ...complete, privateKey: wrongParent });
    expect(parentAnalysis.gates.overall).toBe('insufficient');
    expect(firstReasonIncludes(parentAnalysis, 'config fingerprint')).toBeTrue();

    const invalidGrades = structuredClone(complete.resolved) as HydeResolvedAdjudicationArtifact;
    const caseCandidateIds = new Set(HYDE_CASES[0].candidates.map((candidate) => candidate.id));
    const mappingByOpaque = new Map(complete.privateKey.mappings.map((mapping) => [mapping.opaqueId, mapping]));
    for (const item of invalidGrades.items) {
      const mapping = mappingByOpaque.get(item.opaqueId);
      if (item.status === 'resolved' && item.taskKind === 'candidate-relevance'
        && mapping?.taskKind === 'candidate-relevance' && caseCandidateIds.has(mapping.candidateId)) {
        item.finalRelevanceGrade = 0;
      }
    }
    const gradeAnalysis = analyze({ ...complete, resolved: HydeResolvedAdjudicationArtifactSchema.parse(invalidGrades) });
    expect(gradeAnalysis.gates.overall).toBe('insufficient');
    expect(firstReasonIncludes(gradeAnalysis, 'must preserve 2-3 positives')).toBeTrue();
  });

  it('rejects a hand-edited PASS with inconsistent gates, canonicality, or bootstrap provenance', () => {
    const analysis = analyze(bundle());
    const tampered = structuredClone(analysis) as typeof analysis;
    tampered.canonicality = { status: 'canonical', reasons: [] };
    tampered.gates.overall = 'pass';
    tampered.gates.records.forEach((record) => {
      record.status = 'pass';
      record.boundValue = 0;
    });
    expect(() => parseHydeAnalysisArtifact(tampered)).toThrow();

    const reordered = structuredClone(analysis) as typeof analysis;
    [reordered.gates.records[0], reordered.gates.records[1]] = [
      reordered.gates.records[1],
      reordered.gates.records[0],
    ];
    expect(() => parseHydeAnalysisArtifact(reordered)).toThrow('canonical order');
  });

  it('keeps production verdict payloads outside canonical metrics/gates and emits a safe report', () => {
    const complete = bundle();
    const first = analyze(complete);
    const changedCollection = structuredClone(complete.collection) as HydeCollectionArtifact;
    for (const block of changedCollection.pairedBlocks) {
      if (block.frameV1.status !== 'completed') continue;
      for (const document of block.frameV1.result.documents) {
        if (document.verdict) document.verdict.valid = !document.verdict.valid;
      }
    }
    const changed = analyze(bundle(HydeCollectionArtifactSchema.parse(changedCollection)));
    expect(changed.metrics).toEqual(first.metrics);
    expect(changed.gates).toEqual(first.gates);

    expect(first.resources.configuredProviderIdentity).toMatchObject({ available: false });
    expect(first.resources.configuredProviderIdentity.reason).toContain('fallback');
    expect(first.resources.frameExtractionCalls).toMatchObject({ available: false });
    expect(first.limitations.some((limitation) => limitation.includes('per-call fallback'))).toBeTrue();
    expect(first.limitations.some((limitation) => limitation.includes('unsigned JSON'))).toBeTrue();
    const report = buildHydeEvidenceReport(first);
    const markdown = renderHydeEvidenceMarkdown(report);
    expect(markdown.startsWith('# INSUFFICIENT')).toBeTrue();
    expect(markdown).toContain('## Limitations');
    expect(markdown).toContain('## Background-source diagnostics (non-gating point estimates)');
    expect(markdown).toContain('### saved-intent');
    expect(markdown).toContain('### user-context');
    expect(markdown).toContain(`cases ${HYDE_EXPECTED_SOURCE_CASE_COUNTS['saved-intent']}/${HYDE_EXPECTED_SOURCE_CASE_COUNTS['saved-intent']}; pairs observed ${HYDE_EXPECTED_SOURCE_PAIR_COUNTS['saved-intent']}/${HYDE_EXPECTED_SOURCE_PAIR_COUNTS['saved-intent']}`);
    expect(markdown).toContain(`cases ${HYDE_EXPECTED_SOURCE_CASE_COUNTS['user-context']}/${HYDE_EXPECTED_SOURCE_CASE_COUNTS['user-context']}; pairs observed ${HYDE_EXPECTED_SOURCE_PAIR_COUNTS['user-context']}/${HYDE_EXPECTED_SOURCE_PAIR_COUNTS['user-context']}`);
    expect(markdown).toContain('Per-call provider/model identity: unavailable');
    expect(markdown).toContain('Separate frame-extraction calls: unavailable');
    expect(markdown).toContain('NONCANONICAL production-validator appendix');
    expect(markdown).not.toContain('analysis-test-hmac-secret');
    expect(markdown).not.toContain('mappings');
    expect(JSON.stringify(report)).not.toContain('analysis-test-hmac-secret');
    expect(JSON.stringify(report)).not.toContain('candidate-relevance');
  });
});
