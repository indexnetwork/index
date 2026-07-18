import { HYDE_CASES, HYDE_CORPUS_FINGERPRINT } from '../hyde.cases.js';
import { HYDE_ARTIFACT_SCHEMA_VERSION, HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING, HYDE_BOOTSTRAP_SEED, HYDE_CANONICAL_EMBEDDING_PIN, HYDE_CANONICAL_FRAME_GENERATION_VERSION, HYDE_CANONICAL_MODEL_PINS, HYDE_CANONICAL_PROVENANCE_PINS, HYDE_CANONICAL_RUNS, HYDE_CORPUS_VERSION, HYDE_EXECUTION_SEED, HYDE_GATE_POLICY_VERSION, HYDE_LENS_BONUS, HYDE_MAX_LENSES, HYDE_MIN_SCORE, HYDE_RUBRIC_VERSION } from '../hyde.policy.js';
import { HYDE_COLLECTION_ARTIFACT_TYPE, type HydeBlindPublicBatch, type HydeCollectionArtifact, type HydeIndependentJudgment, type HydeJudgmentArtifact } from '../hyde.schemas.js';
import { fingerprintHydeArtifact, parseHydeCollectionArtifact } from '../hyde.artifacts.js';
import { buildHydeJudgmentArtifact } from '../hyde.adjudication.js';
import { buildCounterbalancedSchedule } from '../hyde.runner.js';

const TIMING = {
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:01.000Z',
  durationMs: 1_000,
} as const;

function result(caseId: string, run: number, mode: 'legacy' | 'frame-v1') {
  const c = HYDE_CASES.find((candidate) => candidate.id === caseId);
  if (!c) throw new Error(`Unknown fixture case ${caseId}`);
  const documents = mode === 'legacy'
    ? [
      {
        lens: 'SECRET_LEGACY_LENS',
        corpus: 'profiles' as const,
        text: 'Legacy generated document one.',
        mapStatus: 'overwritten' as const,
        validationStatus: 'not_applicable' as const,
        validatorKey: 'SECRET_VALIDATOR_KEY_ONE',
        returned: false,
      },
      {
        lens: 'SECRET_LEGACY_LENS_TWO',
        corpus: 'intents' as const,
        text: 'Legacy generated document two.',
        mapStatus: 'submitted' as const,
        validationStatus: 'not_applicable' as const,
        validatorKey: 'SECRET_VALIDATOR_KEY_TWO',
        returned: true,
      },
    ]
    : [
      {
        lens: 'SECRET_FRAME_LENS',
        corpus: 'premises' as const,
        text: 'Frame generated document rejected by production diagnostics.',
        mapStatus: 'submitted' as const,
        validationStatus: 'invalid' as const,
        validatorKey: 'SECRET_VALIDATOR_KEY_THREE',
        returned: false,
        verdict: {
          key: 'SECRET_VALIDATOR_KEY_THREE',
          valid: false,
          unsupportedNamedEntities: ['SECRET_ENTITY'],
          unsupportedHardConstraints: ['SECRET_CONSTRAINT'],
          reasoning: 'SECRET_VALIDATOR_REASONING',
        },
      },
      {
        lens: 'SECRET_FRAME_OVERWRITTEN',
        corpus: 'intents' as const,
        text: 'Frame generated document overwritten before validation.',
        mapStatus: 'overwritten' as const,
        validationStatus: 'not_submitted' as const,
        validatorKey: 'SECRET_VALIDATOR_KEY_FOUR',
        returned: false,
      },
      {
        lens: 'SECRET_FRAME_FAILED_OPEN',
        corpus: 'premises' as const,
        text: 'Frame generated document retained after validator failure.',
        mapStatus: 'submitted' as const,
        validationStatus: 'failed_open' as const,
        validatorKey: 'SECRET_VALIDATOR_KEY_FIVE',
        failedOpenReason: 'validator_error' as const,
        returned: true,
      },
    ];
  return {
    caseId,
    mode,
    run,
    allCandidateScores: c.candidates.map((candidate) => ({
      candidateId: candidate.id,
      role: candidate.role,
      relevanceGrade: candidate.relevanceGrade,
      corpus: candidate.corpus,
      ...(candidate.hardNegativeOf ? { hardNegativeOf: candidate.hardNegativeOf } : {}),
      score: 0,
      lensMatches: [{ lensId: documents.find((document) => document.returned)?.lens ?? 'fixture-lens', cosine: 0 }],
      maxCosine: 0,
      qualifyingMatchCount: 0,
      matchedLensIds: [],
      qualified: false as const,
    })),
    ranking: [],
    lensCount: 2,
    returnedDocumentCount: 1,
    generatedDocumentCount: documents.length,
    overwrittenDocumentCount: 1,
    validatorSubmittedDocumentCount: mode === 'legacy' ? 0 : 2,
    rejectedCount: mode === 'legacy' ? null : 1,
    failedOpenCount: mode === 'legacy' ? 0 : 1,
    documents,
    resources: {
      lensInferenceCalls: [{ durationMs: 10, inputCount: 1, outcome: 'completed' as const }],
      generatorCalls: documents.map(() => ({ durationMs: 20, inputCount: 1, outcome: 'completed' as const })),
      validatorCalls: mode === 'legacy'
        ? []
        : [{ durationMs: 30, inputCount: 2, outcome: 'threw' as const }],
      documentEmbeddingCalls: [{ durationMs: 5, inputCount: 1, outcome: 'completed' as const }],
    },
  };
}

/** Complete-shape collection with only its first pair completed to keep tests focused. */
export function buildCollectionFixture(): HydeCollectionArtifact {
  const pairedBlocks = HYDE_CASES.flatMap((c, caseIndex) =>
    Array.from({ length: HYDE_CANONICAL_RUNS }, (_, runIndex) => {
      const run = runIndex + 1;
      const completed = caseIndex === 0 && run === 1;
      const failedSlot = {
        status: 'failed' as const,
        failure: {
          code: 'generation_error' as const,
          stage: 'generation' as const,
          message: 'Fixture skipped provider call',
          retryable: false as const,
        },
        timing: TIMING,
      };
      return {
        caseId: c.id,
        stratum: c.stratum,
        backgroundSource: c.backgroundSource,
        graphSourceType: HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING[c.backgroundSource],
        run,
        executionOrdinal: caseIndex * HYDE_CANONICAL_RUNS + runIndex,
        modeOrder: run % 2 === 1
          ? ['legacy', 'frame-v1'] as const
          : ['frame-v1', 'legacy'] as const,
        legacy: completed
          ? { status: 'completed' as const, result: result(c.id, run, 'legacy'), timing: TIMING }
          : failedSlot,
        frameV1: completed
          ? { status: 'completed' as const, result: result(c.id, run, 'frame-v1'), timing: TIMING }
          : failedSlot,
      };
    }));

  return parseHydeCollectionArtifact({
    artifactType: HYDE_COLLECTION_ARTIFACT_TYPE,
    schemaVersion: HYDE_ARTIFACT_SCHEMA_VERSION,
    policyVersion: HYDE_GATE_POLICY_VERSION,
    corpusVersion: HYDE_CORPUS_VERSION,
    rubricVersion: HYDE_RUBRIC_VERSION,
    studyId: 'hyde-evidence-test-study',
    createdAt: '2026-01-01T00:00:00.000Z',
    corpusFingerprint: 'a'.repeat(64),
    configFingerprint: 'b'.repeat(64),
    provenance: {
      git: { revision: 'fixture-revision', dirty: false, revisionWithDirtyMarker: 'fixture-revision' },
      models: { lensInferrer: 'lens-model', generator: 'generator-model', validator: 'validator-model' },
      embedding: { baseUrl: 'https://example.test', model: 'embedding-model', dimensions: 8, encodingFormat: 'float' },
      generationVersion: 'frame-v1',
      backgroundSourceGraphMapping: [
        { backgroundSource: 'saved-intent', graphSourceType: 'query' },
        { backgroundSource: 'user-context', graphSourceType: 'context' },
      ],
    },
    canonicality: { candidate: false, reasons: ['fixture contains explicit failed slots'] },
    config: {
      selectedCaseIds: HYDE_CASES.map((c) => c.id),
      runs: HYDE_CANONICAL_RUNS,
      cutoff: HYDE_MIN_SCORE,
      lensBonus: HYDE_LENS_BONUS,
      maxLenses: HYDE_MAX_LENSES,
      seeds: { execution: HYDE_EXECUTION_SEED, bootstrap: HYDE_BOOTSTRAP_SEED },
    },
    candidateEmbeddingSetups: HYDE_CASES.map((c) => ({
      caseId: c.id,
      status: 'completed' as const,
      ...TIMING,
      inputCount: c.candidates.length,
      candidatePoolFingerprint: 'c'.repeat(64),
    })),
    pairedBlocks,
  });
}

/** Full completed shape used only for CLI export guards; provenance remains synthetic. */
export function buildExportableCollectionFixture(): HydeCollectionArtifact {
  const base = buildCollectionFixture();
  const casesById = new Map(HYDE_CASES.map((c) => [c.id, c]));
  const schedule = buildCounterbalancedSchedule(HYDE_CASES.map((c) => c.id));
  const config = {
    selectedCaseIds: HYDE_CASES.map((c) => c.id),
    runs: HYDE_CANONICAL_RUNS,
    cutoff: HYDE_MIN_SCORE,
    lensBonus: HYDE_LENS_BONUS,
    maxLenses: HYDE_MAX_LENSES,
    seeds: { execution: HYDE_EXECUTION_SEED, bootstrap: HYDE_BOOTSTRAP_SEED },
  };
  const provenance = {
    git: { revision: 'a'.repeat(40), dirty: false, revisionWithDirtyMarker: 'a'.repeat(40) },
    models: HYDE_CANONICAL_MODEL_PINS,
    embedding: HYDE_CANONICAL_EMBEDDING_PIN,
    generationVersion: HYDE_CANONICAL_FRAME_GENERATION_VERSION,
    backgroundSourceGraphMapping: [
      { backgroundSource: 'saved-intent' as const, graphSourceType: 'query' as const },
      { backgroundSource: 'user-context' as const, graphSourceType: 'context' as const },
    ],
  };
  const configFingerprint = fingerprintHydeArtifact({
    policyVersion: HYDE_GATE_POLICY_VERSION,
    config,
    policyPins: HYDE_CANONICAL_PROVENANCE_PINS,
    models: provenance.models,
    embedding: provenance.embedding,
    generationVersion: provenance.generationVersion,
    backgroundSourceGraphMapping: provenance.backgroundSourceGraphMapping,
    schedule: schedule.map(({ caseId, run, caseRunHash: hash, modeOrder }) => ({ caseId, run, hash, modeOrder })),
  });
  return parseHydeCollectionArtifact({
    ...base,
    corpusFingerprint: HYDE_CORPUS_FINGERPRINT,
    configFingerprint,
    provenance,
    canonicality: { candidate: true, reasons: [] },
    config,
    candidateEmbeddingSetups: HYDE_CASES.map((c) => ({
      caseId: c.id,
      status: 'completed' as const,
      ...TIMING,
      inputCount: c.candidates.length,
      candidatePoolFingerprint: fingerprintHydeArtifact(c.candidates),
    })),
    pairedBlocks: schedule.map((entry) => {
      const c = casesById.get(entry.caseId);
      if (!c) throw new Error(`Unknown fixture case ${entry.caseId}`);
      return {
        caseId: c.id,
        stratum: c.stratum,
        backgroundSource: c.backgroundSource,
        graphSourceType: HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING[c.backgroundSource],
        run: entry.run,
        executionOrdinal: entry.executionOrdinal,
        modeOrder: entry.modeOrder,
        legacy: { status: 'completed' as const, result: result(c.id, entry.run, 'legacy'), timing: TIMING },
        frameV1: { status: 'completed' as const, result: result(c.id, entry.run, 'frame-v1'), timing: TIMING },
      };
    }),
  });
}

export function judgmentsForBatch(
  batch: HydeBlindPublicBatch,
  candidateGrade: 0 | 1 | 2 | 3 = 2,
  grounding: 'supported' | 'unsupported' | 'unable' = 'supported',
): HydeIndependentJudgment[] {
  return batch.items.map((item): HydeIndependentJudgment => item.taskKind === 'candidate-relevance'
    ? { opaqueId: item.opaqueId, taskKind: item.taskKind, relevanceGrade: candidateGrade }
    : {
      opaqueId: item.opaqueId,
      taskKind: item.taskKind,
      grounding,
      unsupportedAdditions: grounding === 'unsupported'
        ? [{ category: 'other', excerpts: ['unsupported detail'], rationale: 'Absent from source text.' }]
        : [],
    });
}

export function humanJudgment(
  batch: HydeBlindPublicBatch,
  adjudicatorId: string,
  judgments: HydeIndependentJudgment[] = judgmentsForBatch(batch),
  attested = true,
): HydeJudgmentArtifact {
  return buildHydeJudgmentArtifact(batch, {
    adjudicatorId,
    adjudicatorKind: 'human',
    blindedIndependentAttestation: attested,
    judgments,
    createdAt: '2026-01-02T00:00:00.000Z',
  });
}
