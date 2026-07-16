import { z } from 'zod';

import { HYDE_ARTIFACT_SCHEMA_VERSION, HYDE_BACKGROUND_SOURCES, HYDE_BOOTSTRAP_REPLICATES, HYDE_BOOTSTRAP_SEED, HYDE_CORPUS_VERSION, HYDE_EXPECTED_CANDIDATE_COUNT, HYDE_EXPECTED_PAIR_COUNT, HYDE_EXPECTED_SOURCE_CASE_COUNTS, HYDE_EXPECTED_SOURCE_PAIR_COUNTS, HYDE_GATE_POLICY_VERSION, HYDE_GATE_THRESHOLDS, HYDE_RUBRIC_VERSION } from './hyde.policy.js';
import { HYDE_EVAL_STRATA } from './hyde.types.js';

export const HYDE_COLLECTION_ARTIFACT_TYPE = 'hyde-evidence-collection' as const;
export const HYDE_BLIND_PUBLIC_BATCH_ARTIFACT_TYPE = 'hyde-blind-public-batch' as const;
export const HYDE_BLIND_PRIVATE_KEY_ARTIFACT_TYPE = 'hyde-blind-private-key' as const;
export const HYDE_JUDGMENT_ARTIFACT_TYPE = 'hyde-independent-judgment' as const;
export const HYDE_RESOLVER_DECISIONS_ARTIFACT_TYPE = 'hyde-resolver-decisions' as const;
export const HYDE_RESOLVED_ADJUDICATION_ARTIFACT_TYPE = 'hyde-resolved-adjudication' as const;
export const HYDE_ANALYSIS_ARTIFACT_TYPE = 'hyde-evidence-analysis' as const;

export const HYDE_CANDIDATE_TASK_KIND = 'candidate-relevance' as const;
export const HYDE_GROUNDING_TASK_KIND = 'generated-document-grounding' as const;
export const HYDE_CANDIDATE_RUBRIC = 'Grade how relevant the candidate is to satisfying the source: 0 not relevant, 1 weak, 2 relevant, 3 highly relevant.' as const;
export const HYDE_GROUNDING_RUBRIC = 'Judge whether every factual detail in the generated document is supported by the source text alone. Profile context is not support.' as const;

export const HYDE_UNSUPPORTED_ADDITION_CATEGORIES = [
  'named_entity',
  'location',
  'time',
  'numeric_scale',
  'credential',
  'organization',
  'exclusivity',
  'role_polarity',
  'profile_contamination',
  'other',
] as const;

const finiteNumberSchema = z.number().finite('Expected a finite number');
const nonnegativeFiniteSchema = finiteNumberSchema.nonnegative();
const positiveIntegerSchema = finiteNumberSchema.int().positive();
const nonnegativeIntegerSchema = finiteNumberSchema.int().nonnegative();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 hex fingerprint');
const dateTimeSchema = z.string().datetime({ offset: true });
const artifactVersionSchema = z.literal(HYDE_ARTIFACT_SCHEMA_VERSION);
const modeSchema = z.enum(['legacy', 'frame-v1']);
const backgroundSourceSchema = z.enum(HYDE_BACKGROUND_SOURCES);
const graphSourceTypeSchema = z.enum(['query', 'context']);
const taskKindSchema = z.enum([HYDE_CANDIDATE_TASK_KIND, HYDE_GROUNDING_TASK_KIND]);

const gitMetadataSchema = z.object({
  revision: z.string().min(1),
  dirty: z.boolean().nullable(),
  revisionWithDirtyMarker: z.string().min(1),
}).strict();

const modelMetadataSchema = z.object({
  lensInferrer: z.string().min(1),
  generator: z.string().min(1),
  validator: z.string().min(1),
}).strict();

const embeddingMetadataSchema = z.object({
  baseUrl: z.string().min(1),
  model: z.string().min(1),
  dimensions: positiveIntegerSchema,
  encodingFormat: z.literal('float'),
}).strict();

const hardNegativeLinkSchema = z.object({
  positiveCandidateId: z.string().min(1),
  axis: z.string().min(1),
  rationale: z.string().min(1),
}).strict();

const candidateScoreSchema = z.object({
  candidateId: z.string().min(1),
  role: z.enum(['positive', 'hard-negative', 'distractor']),
  relevanceGrade: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  corpus: z.enum(['intents', 'premises']),
  hardNegativeOf: hardNegativeLinkSchema.optional(),
  score: finiteNumberSchema.min(0).max(1),
  lensMatches: z.array(z.object({
    lensId: z.string().min(1),
    cosine: finiteNumberSchema.min(-1).max(1),
  }).strict()),
  maxCosine: finiteNumberSchema.min(-1).max(1),
  qualifyingMatchCount: nonnegativeIntegerSchema,
  matchedLensIds: z.array(z.string().min(1)),
  qualified: z.boolean(),
}).strict();

const rankedCandidateSchema = candidateScoreSchema.extend({
  qualified: z.literal(true),
}).strict();

const validationVerdictSchema = z.object({
  key: z.string().min(1),
  valid: z.boolean(),
  unsupportedNamedEntities: z.array(z.string()),
  unsupportedHardConstraints: z.array(z.string()),
  reasoning: z.string(),
}).strict();

const generatedDocumentDiagnosticSchema = z.object({
  lens: z.string(),
  corpus: z.enum(['profiles', 'intents', 'premises']),
  text: z.string(),
  mapStatus: z.enum(['submitted', 'overwritten']),
  validationStatus: z.enum(['not_applicable', 'not_submitted', 'valid', 'invalid', 'failed_open']),
  validatorKey: z.string().optional(),
  failedOpenReason: z.enum([
    'validator_error',
    'missing_verdict',
    'duplicate_verdict',
    'malformed_verdict',
    'contradictory_verdict',
  ]).optional(),
  returned: z.boolean(),
  verdict: validationVerdictSchema.optional(),
}).strict();

const resourceCallDiagnosticSchema = z.object({
  durationMs: nonnegativeFiniteSchema,
  inputCount: nonnegativeIntegerSchema,
  outcome: z.enum(['completed', 'threw']),
}).strict();

const runResourceDiagnosticsSchema = z.object({
  lensInferenceCalls: z.array(resourceCallDiagnosticSchema),
  generatorCalls: z.array(resourceCallDiagnosticSchema),
  validatorCalls: z.array(resourceCallDiagnosticSchema),
  documentEmbeddingCalls: z.array(resourceCallDiagnosticSchema),
}).strict();

export const HydeEvalRunResultSchema = z.object({
  caseId: z.string().min(1),
  mode: modeSchema,
  run: positiveIntegerSchema,
  allCandidateScores: z.array(candidateScoreSchema),
  ranking: z.array(rankedCandidateSchema),
  lensCount: nonnegativeIntegerSchema,
  returnedDocumentCount: nonnegativeIntegerSchema,
  generatedDocumentCount: nonnegativeIntegerSchema,
  overwrittenDocumentCount: nonnegativeIntegerSchema,
  validatorSubmittedDocumentCount: nonnegativeIntegerSchema,
  rejectedCount: nonnegativeIntegerSchema.nullable(),
  failedOpenCount: nonnegativeIntegerSchema,
  documents: z.array(generatedDocumentDiagnosticSchema),
  resources: runResourceDiagnosticsSchema,
}).strict();

export const HydeRunTimingSchema = z.object({
  startedAt: dateTimeSchema,
  completedAt: dateTimeSchema,
  durationMs: nonnegativeFiniteSchema,
}).strict().superRefine((timing, context) => {
  if (Date.parse(timing.completedAt) < Date.parse(timing.startedAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'completedAt must not precede startedAt' });
  }
});

export const HydeRunFailureSchema = z.object({
  code: z.enum([
    'embedding_error',
    'lens_inference_error',
    'generation_error',
    'validation_error',
    'graph_error',
    'ranking_error',
    'collection_error',
    'unknown',
  ]),
  stage: z.enum(['embedding', 'lens-inference', 'generation', 'validation', 'graph', 'ranking', 'collection']),
  message: z.string().min(1).max(500),
  retryable: z.literal(false),
}).strict();

const completedSlotSchema = z.object({
  status: z.literal('completed'),
  result: HydeEvalRunResultSchema,
  timing: HydeRunTimingSchema,
}).strict();

const failedSlotSchema = z.object({
  status: z.literal('failed'),
  failure: HydeRunFailureSchema,
  timing: HydeRunTimingSchema,
  resources: runResourceDiagnosticsSchema.optional(),
}).strict();

export const HydeCollectionSlotSchema = z.discriminatedUnion('status', [completedSlotSchema, failedSlotSchema]);

const pairedBlockSchema = z.object({
  caseId: z.string().min(1),
  stratum: z.enum(HYDE_EVAL_STRATA),
  backgroundSource: backgroundSourceSchema,
  graphSourceType: graphSourceTypeSchema,
  run: positiveIntegerSchema,
  executionOrdinal: nonnegativeIntegerSchema,
  modeOrder: z.union([
    z.tuple([z.literal('legacy'), z.literal('frame-v1')]),
    z.tuple([z.literal('frame-v1'), z.literal('legacy')]),
  ]),
  legacy: HydeCollectionSlotSchema,
  frameV1: HydeCollectionSlotSchema,
}).strict().superRefine((block, context) => {
  for (const [key, expectedMode] of [['legacy', 'legacy'], ['frameV1', 'frame-v1']] as const) {
    const slot = block[key];
    if (slot.status !== 'completed') continue;
    if (slot.result.caseId !== block.caseId) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key, 'result', 'caseId'], message: 'Result caseId must match paired block' });
    }
    if (slot.result.run !== block.run) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key, 'result', 'run'], message: 'Result run must match paired block' });
    }
    if (slot.result.mode !== expectedMode) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key, 'result', 'mode'], message: `Result mode must be ${expectedMode}` });
    }
  }
});

const collectionConfigSchema = z.object({
  selectedCaseIds: z.array(z.string().min(1)).min(1),
  runs: positiveIntegerSchema,
  cutoff: finiteNumberSchema.min(0).max(1),
  lensBonus: nonnegativeFiniteSchema,
  maxLenses: positiveIntegerSchema,
  seeds: z.object({
    execution: finiteNumberSchema.int(),
    bootstrap: finiteNumberSchema.int(),
  }).strict(),
}).strict();

const candidateEmbeddingSetupBaseSchema = z.object({
  caseId: z.string().min(1),
  startedAt: dateTimeSchema,
  completedAt: dateTimeSchema,
  durationMs: nonnegativeFiniteSchema,
  inputCount: nonnegativeIntegerSchema,
  candidatePoolFingerprint: sha256Schema,
}).strict();

const completedCandidateEmbeddingSetupSchema = candidateEmbeddingSetupBaseSchema.extend({
  status: z.literal('completed'),
}).strict();

const failedCandidateEmbeddingSetupSchema = candidateEmbeddingSetupBaseSchema.extend({
  status: z.literal('failed'),
  failure: HydeRunFailureSchema,
}).strict();

export const HydeCandidateEmbeddingSetupSchema = z.discriminatedUnion('status', [
  completedCandidateEmbeddingSetupSchema,
  failedCandidateEmbeddingSetupSchema,
]);

export const HydeCollectionArtifactSchema = z.object({
  artifactType: z.literal(HYDE_COLLECTION_ARTIFACT_TYPE),
  schemaVersion: artifactVersionSchema,
  policyVersion: z.literal(HYDE_GATE_POLICY_VERSION),
  corpusVersion: z.literal(HYDE_CORPUS_VERSION),
  rubricVersion: z.literal(HYDE_RUBRIC_VERSION),
  studyId: z.string().min(1),
  createdAt: dateTimeSchema,
  corpusFingerprint: sha256Schema,
  configFingerprint: sha256Schema,
  provenance: z.object({
    git: gitMetadataSchema,
    models: modelMetadataSchema,
    embedding: embeddingMetadataSchema,
    generationVersion: z.string().min(1),
    backgroundSourceGraphMapping: z.tuple([
      z.object({ backgroundSource: z.literal('saved-intent'), graphSourceType: z.literal('query') }).strict(),
      z.object({ backgroundSource: z.literal('user-context'), graphSourceType: z.literal('context') }).strict(),
    ]),
  }).strict(),
  canonicality: z.object({
    candidate: z.boolean(),
    reasons: z.array(z.string().min(1)),
  }).strict(),
  config: collectionConfigSchema,
  candidateEmbeddingSetups: z.array(HydeCandidateEmbeddingSetupSchema).min(1),
  pairedBlocks: z.array(pairedBlockSchema),
}).strict().superRefine((artifact, context) => {
  if (artifact.canonicality.candidate !== (artifact.canonicality.reasons.length === 0)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['canonicality'],
      message: 'Canonicality candidate must be true exactly when no noncanonical reasons are present',
    });
  }
  const selected = new Set(artifact.config.selectedCaseIds);
  if (selected.size !== artifact.config.selectedCaseIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['config', 'selectedCaseIds'], message: 'Selected case IDs must be unique' });
  }
  const setupCaseIds = artifact.candidateEmbeddingSetups.map((setup) => setup.caseId);
  if (setupCaseIds.length !== artifact.config.selectedCaseIds.length
    || new Set(setupCaseIds).size !== setupCaseIds.length
    || setupCaseIds.some((caseId) => !selected.has(caseId))) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['candidateEmbeddingSetups'],
      message: 'Candidate embedding setups must account for every selected case exactly once',
    });
  }
  for (const [index, setup] of artifact.candidateEmbeddingSetups.entries()) {
    if (Date.parse(setup.completedAt) < Date.parse(setup.startedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidateEmbeddingSetups', index, 'completedAt'],
        message: 'completedAt must not precede startedAt',
      });
    }
    if (setup.status === 'failed' && setup.failure.stage !== 'embedding') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['candidateEmbeddingSetups', index, 'failure', 'stage'],
        message: 'Candidate embedding setup failures must use the embedding stage',
      });
    }
  }

  const expectedBlocks = artifact.config.selectedCaseIds.length * artifact.config.runs;
  if (artifact.pairedBlocks.length !== expectedBlocks) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['pairedBlocks'], message: `Expected ${expectedBlocks} paired blocks` });
  }
  const blockKeys = new Set<string>();
  const ordinals = new Set<number>();
  for (const [index, block] of artifact.pairedBlocks.entries()) {
    if (!selected.has(block.caseId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['pairedBlocks', index, 'caseId'], message: 'Paired block case is not selected' });
    }
    if (block.run > artifact.config.runs) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['pairedBlocks', index, 'run'], message: 'Paired block run exceeds configured runs' });
    }
    const key = `${block.caseId}\0${block.run}`;
    if (blockKeys.has(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['pairedBlocks', index], message: 'Duplicate case/run paired block' });
    }
    blockKeys.add(key);
    if (ordinals.has(block.executionOrdinal)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['pairedBlocks', index, 'executionOrdinal'], message: 'Execution ordinals must be unique' });
    }
    ordinals.add(block.executionOrdinal);
  }
  if (ordinals.size === expectedBlocks
    && [...ordinals].some((ordinal) => ordinal < 0 || ordinal >= expectedBlocks)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pairedBlocks'],
      message: 'Execution ordinals must be contiguous from zero',
    });
  }
});

const publicCandidateItemSchema = z.object({
  opaqueId: z.string().regex(/^blind-[a-f0-9]{64}$/),
  taskKind: z.literal(HYDE_CANDIDATE_TASK_KIND),
  rubric: z.literal(HYDE_CANDIDATE_RUBRIC),
  sourceText: z.string(),
  itemText: z.string(),
}).strict();

const publicGroundingItemSchema = z.object({
  opaqueId: z.string().regex(/^blind-[a-f0-9]{64}$/),
  taskKind: z.literal(HYDE_GROUNDING_TASK_KIND),
  rubric: z.literal(HYDE_GROUNDING_RUBRIC),
  sourceText: z.string(),
  itemText: z.string(),
}).strict();

export const HydeBlindPublicItemSchema = z.discriminatedUnion('taskKind', [
  publicCandidateItemSchema,
  publicGroundingItemSchema,
]);

export const HydeBlindPublicBatchSchema = z.object({
  artifactType: z.literal(HYDE_BLIND_PUBLIC_BATCH_ARTIFACT_TYPE),
  schemaVersion: artifactVersionSchema,
  studyId: z.string().min(1),
  createdAt: dateTimeSchema,
  rubricVersion: z.literal(HYDE_RUBRIC_VERSION),
  collectionFingerprint: sha256Schema,
  corpusFingerprint: sha256Schema,
  configFingerprint: sha256Schema,
  batchFingerprint: sha256Schema,
  items: z.array(HydeBlindPublicItemSchema),
}).strict().superRefine((batch, context) => {
  const candidateCount = batch.items.filter((item) => item.taskKind === HYDE_CANDIDATE_TASK_KIND).length;
  if (candidateCount !== HYDE_EXPECTED_CANDIDATE_COUNT) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: `Blind batch must contain exactly ${HYDE_EXPECTED_CANDIDATE_COUNT} candidate items` });
  }
  const ids = new Set(batch.items.map((item) => item.opaqueId));
  if (ids.size !== batch.items.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Blind item IDs must be unique' });
  }
});

const privateCandidateMappingSchema = z.object({
  opaqueId: z.string().regex(/^blind-[a-f0-9]{64}$/),
  taskKind: z.literal(HYDE_CANDIDATE_TASK_KIND),
  candidateId: z.string().min(1),
}).strict();

const privateGroundingMappingSchema = z.object({
  opaqueId: z.string().regex(/^blind-[a-f0-9]{64}$/),
  taskKind: z.literal(HYDE_GROUNDING_TASK_KIND),
  caseId: z.string().min(1),
  run: positiveIntegerSchema,
  mode: modeSchema,
  documentIndex: nonnegativeIntegerSchema,
}).strict();

export const HydeBlindPrivateMappingSchema = z.discriminatedUnion('taskKind', [
  privateCandidateMappingSchema,
  privateGroundingMappingSchema,
]);

export const HydeBlindPrivateKeySchema = z.object({
  artifactType: z.literal(HYDE_BLIND_PRIVATE_KEY_ARTIFACT_TYPE),
  schemaVersion: artifactVersionSchema,
  studyId: z.string().min(1),
  createdAt: dateTimeSchema,
  batchFingerprint: sha256Schema,
  collectionFingerprint: sha256Schema,
  corpusFingerprint: sha256Schema,
  configFingerprint: sha256Schema,
  hmacSecret: z.string().min(1),
  mappings: z.array(HydeBlindPrivateMappingSchema),
}).strict().superRefine((key, context) => {
  const ids = new Set(key.mappings.map((mapping) => mapping.opaqueId));
  if (ids.size !== key.mappings.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['mappings'], message: 'Private mappings must have unique opaque IDs' });
  }
});

export const HydeUnsupportedAdditionSchema = z.object({
  category: z.enum(HYDE_UNSUPPORTED_ADDITION_CATEGORIES),
  excerpts: z.array(z.string().trim().min(1)).min(1),
  rationale: z.string().min(1),
}).strict();

const candidateJudgmentSchema = z.object({
  opaqueId: z.string().min(1),
  taskKind: z.literal(HYDE_CANDIDATE_TASK_KIND),
  relevanceGrade: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
}).strict();

const groundingJudgmentBaseSchema = z.object({
  opaqueId: z.string().min(1),
  taskKind: z.literal(HYDE_GROUNDING_TASK_KIND),
}).strict();

const groundingJudgmentSchema = z.discriminatedUnion('grounding', [
  groundingJudgmentBaseSchema.extend({
    grounding: z.literal('supported'),
    unsupportedAdditions: z.array(HydeUnsupportedAdditionSchema).length(0),
  }).strict(),
  groundingJudgmentBaseSchema.extend({
    grounding: z.literal('unsupported'),
    unsupportedAdditions: z.array(HydeUnsupportedAdditionSchema).min(1),
  }).strict(),
  groundingJudgmentBaseSchema.extend({
    grounding: z.literal('unable'),
    unsupportedAdditions: z.array(HydeUnsupportedAdditionSchema).length(0),
  }).strict(),
]);

export const HydeIndependentJudgmentSchema = z.union([
  candidateJudgmentSchema,
  groundingJudgmentSchema,
]);

export const HydeJudgmentArtifactSchema = z.object({
  artifactType: z.literal(HYDE_JUDGMENT_ARTIFACT_TYPE),
  schemaVersion: artifactVersionSchema,
  createdAt: dateTimeSchema,
  adjudicatorId: z.string().min(1),
  adjudicatorKind: z.enum(['human', 'llm-triage']),
  batchFingerprint: sha256Schema,
  blindedIndependentAttestation: z.boolean(),
  judgments: z.array(HydeIndependentJudgmentSchema),
}).strict();

const candidateResolverDecisionSchema = z.object({
  opaqueId: z.string().min(1),
  taskKind: z.literal(HYDE_CANDIDATE_TASK_KIND),
  finalRelevanceGrade: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  rationale: z.string().min(1),
}).strict();

const groundingResolverDecisionBaseSchema = z.object({
  opaqueId: z.string().min(1),
  taskKind: z.literal(HYDE_GROUNDING_TASK_KIND),
  rationale: z.string().min(1),
}).strict();

const groundingResolverDecisionSchema = z.discriminatedUnion('finalGrounding', [
  groundingResolverDecisionBaseSchema.extend({
    finalGrounding: z.literal('supported'),
    unsupportedAdditions: z.array(HydeUnsupportedAdditionSchema).length(0),
  }).strict(),
  groundingResolverDecisionBaseSchema.extend({
    finalGrounding: z.literal('unsupported'),
    unsupportedAdditions: z.array(HydeUnsupportedAdditionSchema).min(1),
  }).strict(),
]);

export const HydeResolverDecisionSchema = z.union([
  candidateResolverDecisionSchema,
  groundingResolverDecisionSchema,
]);

export const HydeResolverDecisionsArtifactSchema = z.object({
  artifactType: z.literal(HYDE_RESOLVER_DECISIONS_ARTIFACT_TYPE),
  schemaVersion: artifactVersionSchema,
  createdAt: dateTimeSchema,
  resolverId: z.string().min(1),
  batchFingerprint: sha256Schema,
  decisions: z.array(HydeResolverDecisionSchema),
}).strict();

const resolvedCandidateRecordSchema = z.object({
  status: z.literal('resolved'),
  opaqueId: z.string().min(1),
  taskKind: z.literal(HYDE_CANDIDATE_TASK_KIND),
  finalRelevanceGrade: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  resolution: z.enum(['agreement', 'resolver']),
  adjudicatorIds: z.array(z.string().min(1)).min(2),
  resolverId: z.string().min(1).optional(),
  rationale: z.string().min(1).optional(),
}).strict();

const resolvedGroundingRecordBaseSchema = z.object({
  status: z.literal('resolved'),
  opaqueId: z.string().min(1),
  taskKind: z.literal(HYDE_GROUNDING_TASK_KIND),
  resolution: z.enum(['agreement', 'resolver']),
  adjudicatorIds: z.array(z.string().min(1)).min(2),
  resolverId: z.string().min(1).optional(),
  rationale: z.string().min(1).optional(),
}).strict();

const resolvedGroundingRecordSchema = z.discriminatedUnion('finalGrounding', [
  resolvedGroundingRecordBaseSchema.extend({
    finalGrounding: z.literal('supported'),
    unsupportedAdditions: z.array(HydeUnsupportedAdditionSchema).length(0),
  }).strict(),
  resolvedGroundingRecordBaseSchema.extend({
    finalGrounding: z.literal('unsupported'),
    unsupportedAdditions: z.array(HydeUnsupportedAdditionSchema).min(1),
  }).strict(),
]);

const unresolvedRecordSchema = z.object({
  status: z.enum(['missing-evidence', 'unresolved']),
  opaqueId: z.string().min(1),
  taskKind: taskKindSchema,
  reason: z.enum([
    'insufficient-independent-human-judgments',
    'invalid-human-coverage',
    'resolver-decision-required',
  ]),
}).strict();

export const HydeResolvedItemSchema = z.union([
  resolvedCandidateRecordSchema,
  resolvedGroundingRecordSchema,
  unresolvedRecordSchema,
]);

const resolvedSourceJudgmentSchema = z.object({
  fingerprint: sha256Schema,
  adjudicatorId: z.string().min(1),
  adjudicatorKind: z.enum(['human', 'llm-triage']),
}).strict();

export const HydeResolvedAdjudicationArtifactSchema = z.object({
  artifactType: z.literal(HYDE_RESOLVED_ADJUDICATION_ARTIFACT_TYPE),
  schemaVersion: artifactVersionSchema,
  studyId: z.string().min(1),
  createdAt: dateTimeSchema,
  batchFingerprint: sha256Schema,
  sourceProvenance: z.object({
    judgmentArtifacts: z.array(resolvedSourceJudgmentSchema),
    resolverDecisionsFingerprint: sha256Schema.optional(),
  }).strict(),
  status: z.enum(['complete', 'incomplete']),
  canonical: z.boolean(),
  reasons: z.array(z.string().min(1)),
  coverage: z.object({
    publicItemCount: nonnegativeIntegerSchema,
    submittedHumanArtifactCount: nonnegativeIntegerSchema,
    completeAttestedHumanAdjudicatorCount: nonnegativeIntegerSchema,
    invalidHumanArtifactCount: nonnegativeIntegerSchema,
    triageArtifactCount: nonnegativeIntegerSchema,
    completeTriageArtifactCount: nonnegativeIntegerSchema,
  }).strict(),
  counts: z.object({
    resolved: nonnegativeIntegerSchema,
    agreement: nonnegativeIntegerSchema,
    disagreement: nonnegativeIntegerSchema,
    unresolved: nonnegativeIntegerSchema,
    missingEvidence: nonnegativeIntegerSchema,
  }).strict(),
  diagnostics: z.object({
    invalidJudgmentArtifacts: z.array(z.object({
      adjudicatorId: z.string().min(1),
      reasons: z.array(z.string().min(1)).min(1),
    }).strict()),
    triage: z.array(z.object({
      adjudicatorId: z.string().min(1),
      complete: z.boolean(),
      attested: z.boolean(),
    }).strict()),
  }).strict(),
  items: z.array(HydeResolvedItemSchema),
}).strict().superRefine((artifact, context) => {
  const compareAscii = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
  const provenance = artifact.sourceProvenance.judgmentArtifacts;
  const sortedProvenance = [...provenance].sort((left, right) =>
    compareAscii(left.adjudicatorKind, right.adjudicatorKind)
      || compareAscii(left.adjudicatorId, right.adjudicatorId)
      || compareAscii(left.fingerprint, right.fingerprint));
  if (provenance.some((entry, index) => entry !== sortedProvenance[index])) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceProvenance', 'judgmentArtifacts'], message: 'Judgment source provenance must use canonical ASCII order' });
  }
  if (artifact.items.length !== artifact.coverage.publicItemCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Resolved artifact must explicitly account for every public item' });
  }
  const ids = new Set(artifact.items.map((item) => item.opaqueId));
  if (ids.size !== artifact.items.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'Resolved artifact item IDs must be unique' });
  }
  if (artifact.counts.resolved + artifact.counts.unresolved !== artifact.coverage.publicItemCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['counts'], message: 'Resolved plus unresolved count must equal public item count' });
  }
});

const percentileIntervalSchema = z.object({
  lower: finiteNumberSchema,
  upper: finiteNumberSchema,
}).strict();

const bootstrapProvenanceSchema = z.object({
  seed: finiteNumberSchema.int(),
  prng: z.literal('mulberry32-v1'),
  replicateCount: positiveIntegerSchema,
  quantileMethod: z.literal('linear-interpolation-r7'),
}).strict();

const perStratumPairedEstimateSchema = z.object({
  stratum: z.enum(HYDE_EVAL_STRATA),
  legacy: finiteNumberSchema,
  frameV1: finiteNumberSchema,
  delta: finiteNumberSchema,
}).strict();

const pairedMetricAvailableSchema = z.object({
  available: z.literal(true),
  pointEstimate: z.object({
    legacy: finiteNumberSchema,
    frameV1: finiteNumberSchema,
    delta: finiteNumberSchema,
  }).strict(),
  confidenceIntervals: z.object({
    legacy: percentileIntervalSchema,
    frameV1: percentileIntervalSchema,
    delta: percentileIntervalSchema,
  }).strict(),
  provenance: bootstrapProvenanceSchema,
  perStratum: z.array(perStratumPairedEstimateSchema).length(HYDE_EVAL_STRATA.length),
}).strict();

const metricUnavailableSchema = z.object({
  available: z.literal(false),
  reasons: z.array(z.string().min(1)).min(1),
}).strict();

export const HydePairedMetricAnalysisSchema = z.discriminatedUnion('available', [
  pairedMetricAvailableSchema,
  metricUnavailableSchema,
]);

const perStratumScalarEstimateSchema = z.object({
  stratum: z.enum(HYDE_EVAL_STRATA),
  value: finiteNumberSchema,
}).strict();

const scalarMetricAvailableSchema = z.object({
  available: z.literal(true),
  pointEstimate: finiteNumberSchema,
  confidenceInterval: percentileIntervalSchema,
  provenance: bootstrapProvenanceSchema,
  perStratum: z.array(perStratumScalarEstimateSchema).length(HYDE_EVAL_STRATA.length),
}).strict();

export const HydeScalarMetricAnalysisSchema = z.discriminatedUnion('available', [
  scalarMetricAvailableSchema,
  metricUnavailableSchema,
]);

export const HYDE_GATE_IDS = [
  'grounding-delta-upper-exclusive-zero',
  'frame-grounding-upper',
  'precision-at-5-delta-lower',
  'ndcg-at-5-delta-lower',
  'margin-delta-lower',
  'hard-negative-fpr-delta-upper',
  'frame-all-rejected-upper',
  'frame-failed-open-upper',
] as const;

export const HydeGateRecordSchema = z.object({
  policyVersion: z.literal(HYDE_GATE_POLICY_VERSION),
  id: z.enum(HYDE_GATE_IDS),
  boundValue: finiteNumberSchema.nullable(),
  comparator: z.enum(['<', '<=', '>=']),
  threshold: finiteNumberSchema,
  status: z.enum(['pass', 'fail', 'insufficient']),
  reason: z.string().min(1),
}).strict();

const distributionSummarySchema = z.object({
  count: nonnegativeIntegerSchema,
  p50: finiteNumberSchema.nullable(),
  p95: finiteNumberSchema.nullable(),
  mean: finiteNumberSchema.nullable(),
}).strict();

const resourceAggregateSchema = z.object({
  callCount: nonnegativeIntegerSchema,
  inputCount: nonnegativeIntegerSchema,
  outcomes: z.object({
    completed: nonnegativeIntegerSchema,
    threw: nonnegativeIntegerSchema,
  }).strict(),
  durationMs: distributionSummarySchema,
}).strict();

const modeRunDiagnosticsSchema = z.object({
  mode: modeSchema,
  attemptedRunCount: nonnegativeIntegerSchema,
  completedRunCount: nonnegativeIntegerSchema,
  failedRunCount: nonnegativeIntegerSchema,
  durationMs: distributionSummarySchema,
  generatedDocumentCount: nonnegativeIntegerSchema,
  returnedDocumentCount: nonnegativeIntegerSchema,
  emptyGenerationRunCount: nonnegativeIntegerSchema,
  overwrittenDocumentCount: nonnegativeIntegerSchema,
  rejectedDocumentCount: nonnegativeIntegerSchema,
  failedOpenDocumentCount: nonnegativeIntegerSchema,
  allRejectedRunCount: nonnegativeIntegerSchema,
}).strict();

const validatorClassCountsSchema = z.object({
  accepted: nonnegativeIntegerSchema,
  rejected: nonnegativeIntegerSchema,
  failedOpen: nonnegativeIntegerSchema,
  unclassifiable: nonnegativeIntegerSchema,
}).strict();

const sourceCoverageSchema = z.object({
  backgroundSource: backgroundSourceSchema,
  expectedCaseCount: positiveIntegerSchema,
  caseCount: nonnegativeIntegerSchema,
  expectedPairCount: positiveIntegerSchema,
  observedPairCount: nonnegativeIntegerSchema,
  completedPairCount: nonnegativeIntegerSchema,
}).strict();

const pairedPointDiagnosticSchema = z.discriminatedUnion('available', [
  z.object({
    available: z.literal(true),
    pointEstimate: z.object({
      legacy: finiteNumberSchema,
      frameV1: finiteNumberSchema,
      delta: finiteNumberSchema,
    }).strict(),
  }).strict(),
  metricUnavailableSchema,
]);

const scalarPointDiagnosticSchema = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true), pointEstimate: finiteNumberSchema }).strict(),
  metricUnavailableSchema,
]);

const sourcePointDiagnosticsSchema = z.object({
  backgroundSource: backgroundSourceSchema,
  coverage: sourceCoverageSchema.omit({ backgroundSource: true }),
  metrics: z.object({
    precisionAt5: pairedPointDiagnosticSchema,
    ndcgAt5: pairedPointDiagnosticSchema,
    hardNegativeFprAt5: pairedPointDiagnosticSchema,
    margin: pairedPointDiagnosticSchema,
    unsupportedAdditionRate: pairedPointDiagnosticSchema,
    groundingErrorRate: pairedPointDiagnosticSchema,
    frameAllRejectedRate: scalarPointDiagnosticSchema,
    frameFailedOpenRate: scalarPointDiagnosticSchema,
  }).strict(),
}).strict();

export const HydeAnalysisArtifactSchema = z.object({
  artifactType: z.literal(HYDE_ANALYSIS_ARTIFACT_TYPE),
  schemaVersion: artifactVersionSchema,
  policyVersion: z.literal(HYDE_GATE_POLICY_VERSION),
  corpusVersion: z.literal(HYDE_CORPUS_VERSION),
  rubricVersion: z.literal(HYDE_RUBRIC_VERSION),
  studyId: z.string().min(1),
  generatedAt: dateTimeSchema,
  parents: z.object({
    collectionFingerprint: sha256Schema,
    privateKeyFingerprint: sha256Schema,
    resolvedAdjudicationFingerprint: sha256Schema,
    batchFingerprint: sha256Schema,
    corpusFingerprint: sha256Schema,
    configFingerprint: sha256Schema,
  }).strict(),
  canonicality: z.object({
    status: z.enum(['canonical', 'insufficient']),
    reasons: z.array(z.string().min(1)),
  }).strict(),
  completeness: z.object({
    expectedPairCount: z.literal(HYDE_EXPECTED_PAIR_COUNT),
    observedPairCount: nonnegativeIntegerSchema,
    completedPairCount: nonnegativeIntegerSchema,
    failedPairCount: nonnegativeIntegerSchema,
    missingPairCount: nonnegativeIntegerSchema,
    incompletePairCount: nonnegativeIntegerSchema,
    incompletePairRate: finiteNumberSchema.min(0).max(1),
    expectedCandidateMappingCount: z.literal(HYDE_EXPECTED_CANDIDATE_COUNT),
    candidateMappingCount: nonnegativeIntegerSchema,
    expectedGeneratedDocumentMappingCount: nonnegativeIntegerSchema,
    generatedDocumentMappingCount: nonnegativeIntegerSchema,
  }).strict(),
  sourceCoverage: z.array(sourceCoverageSchema).length(HYDE_BACKGROUND_SOURCES.length),
  perBackgroundSource: z.array(sourcePointDiagnosticsSchema).length(HYDE_BACKGROUND_SOURCES.length),
  adjudication: z.object({
    status: z.enum(['complete', 'incomplete']),
    canonical: z.boolean(),
    coverage: z.object({
      publicItemCount: nonnegativeIntegerSchema,
      submittedHumanArtifactCount: nonnegativeIntegerSchema,
      completeAttestedHumanAdjudicatorCount: nonnegativeIntegerSchema,
      invalidHumanArtifactCount: nonnegativeIntegerSchema,
      triageArtifactCount: nonnegativeIntegerSchema,
      completeTriageArtifactCount: nonnegativeIntegerSchema,
    }).strict(),
    counts: z.object({
      resolved: nonnegativeIntegerSchema,
      agreement: nonnegativeIntegerSchema,
      disagreement: nonnegativeIntegerSchema,
      unresolved: nonnegativeIntegerSchema,
      missingEvidence: nonnegativeIntegerSchema,
    }).strict(),
  }).strict(),
  metrics: z.object({
    precisionAt5: HydePairedMetricAnalysisSchema,
    ndcgAt5: HydePairedMetricAnalysisSchema,
    hardNegativeFprAt5: HydePairedMetricAnalysisSchema,
    margin: HydePairedMetricAnalysisSchema,
    unsupportedAdditionRate: HydePairedMetricAnalysisSchema,
    groundingErrorRate: HydePairedMetricAnalysisSchema,
    frameAllRejectedRate: HydeScalarMetricAnalysisSchema,
    frameFailedOpenRate: HydeScalarMetricAnalysisSchema,
  }).strict(),
  gates: z.object({
    policyVersion: z.literal(HYDE_GATE_POLICY_VERSION),
    overall: z.enum(['pass', 'fail', 'insufficient']),
    records: z.array(HydeGateRecordSchema).length(HYDE_GATE_IDS.length),
  }).strict(),
  resources: z.object({
    candidateEmbeddings: z.object({
      setupCount: nonnegativeIntegerSchema,
      completedCount: nonnegativeIntegerSchema,
      failedCount: nonnegativeIntegerSchema,
      inputCount: nonnegativeIntegerSchema,
      durationMs: distributionSummarySchema,
    }).strict(),
    modeRuns: z.array(modeRunDiagnosticsSchema).length(2),
    productionWrapperCalls: z.object({
      lensInference: resourceAggregateSchema,
      generator: resourceAggregateSchema,
      validator: resourceAggregateSchema,
      documentEmbeddings: resourceAggregateSchema,
    }).strict(),
    configuredProviderIdentity: z.object({ available: z.literal(false), reason: z.string().min(1) }).strict(),
    frameExtractionCalls: z.object({ available: z.literal(false), reason: z.string().min(1) }).strict(),
    tokens: z.object({ available: z.literal(false), reason: z.string().min(1) }).strict(),
    cost: z.object({ available: z.literal(false), reason: z.string().min(1) }).strict(),
  }).strict(),
  limitations: z.array(z.string().min(1)).min(1),
  noncanonicalValidatorDiagnostics: z.object({
    canonical: z.literal(false),
    label: z.literal('NONCANONICAL production-validator appendix'),
    humanUnsupported: z.object({
      generatedDocumentCount: nonnegativeIntegerSchema,
      returnedDocumentCount: nonnegativeIntegerSchema,
      production: validatorClassCountsSchema,
    }).strict(),
    comparison: z.object({
      classifiableCount: nonnegativeIntegerSchema,
      agreementCount: nonnegativeIntegerSchema,
      falseAcceptCount: nonnegativeIntegerSchema,
      falseRejectCount: nonnegativeIntegerSchema,
    }).strict(),
  }).strict(),
}).strict().superRefine((artifact, context) => {
  const addIssue = (path: Array<string | number>, message: string): void => {
    context.addIssue({ code: z.ZodIssueCode.custom, path, message });
  };
  for (const [index, source] of HYDE_BACKGROUND_SOURCES.entries()) {
    const coverage = artifact.sourceCoverage[index];
    const diagnostics = artifact.perBackgroundSource[index];
    if (coverage?.backgroundSource !== source || diagnostics?.backgroundSource !== source) {
      addIssue(['sourceCoverage', index], 'Background-source diagnostics must use canonical source order');
      continue;
    }
    if (coverage.expectedCaseCount !== HYDE_EXPECTED_SOURCE_CASE_COUNTS[source]
      || coverage.caseCount !== HYDE_EXPECTED_SOURCE_CASE_COUNTS[source]
      || coverage.expectedPairCount !== HYDE_EXPECTED_SOURCE_PAIR_COUNTS[source]) {
      addIssue(['sourceCoverage', index], 'Background-source coverage must match canonical source counts');
    }
    if (coverage.expectedCaseCount !== diagnostics.coverage.expectedCaseCount
      || coverage.caseCount !== diagnostics.coverage.caseCount
      || coverage.expectedPairCount !== diagnostics.coverage.expectedPairCount
      || coverage.observedPairCount !== diagnostics.coverage.observedPairCount
      || coverage.completedPairCount !== diagnostics.coverage.completedPairCount) {
      addIssue(['perBackgroundSource', index, 'coverage'], 'Per-source diagnostic coverage must match source coverage');
    }
  }
  const expectedCanonicality = artifact.canonicality.reasons.length === 0 ? 'canonical' : 'insufficient';
  if (artifact.canonicality.status !== expectedCanonicality) {
    addIssue(['canonicality'], 'Canonicality status must be canonical exactly when reasons are empty');
  }

  const completenessConsistent = artifact.completeness.observedPairCount + artifact.completeness.missingPairCount
      === artifact.completeness.expectedPairCount
    && artifact.completeness.completedPairCount + artifact.completeness.failedPairCount
      === artifact.completeness.observedPairCount
    && artifact.completeness.failedPairCount + artifact.completeness.missingPairCount
      === artifact.completeness.incompletePairCount
    && artifact.completeness.incompletePairRate
      === artifact.completeness.incompletePairCount / artifact.completeness.expectedPairCount;
  if (!completenessConsistent) {
    addIssue(['completeness'], 'Pair completeness summaries are internally inconsistent');
  }
  const incompleteEvidence = artifact.completeness.incompletePairCount > 0
    || artifact.completeness.completedPairCount !== artifact.completeness.expectedPairCount
    || artifact.completeness.candidateMappingCount !== artifact.completeness.expectedCandidateMappingCount
    || artifact.completeness.generatedDocumentMappingCount
      !== artifact.completeness.expectedGeneratedDocumentMappingCount;
  const noncanonicalAdjudication = artifact.adjudication.status !== 'complete'
    || !artifact.adjudication.canonical
    || artifact.adjudication.coverage.completeAttestedHumanAdjudicatorCount < 2
    || artifact.adjudication.coverage.invalidHumanArtifactCount > 0
    || artifact.adjudication.counts.unresolved > 0
    || artifact.adjudication.counts.missingEvidence > 0;

  const allMetrics = Object.values(artifact.metrics);
  const unavailableMetric = allMetrics.some((metric) => !metric.available);
  const noncanonicalBootstrap = allMetrics.some((metric) => metric.available
    && (metric.provenance.seed !== HYDE_BOOTSTRAP_SEED
      || metric.provenance.replicateCount !== HYDE_BOOTSTRAP_REPLICATES));
  const semanticInsufficiency = incompleteEvidence
    || noncanonicalAdjudication
    || unavailableMetric
    || noncanonicalBootstrap;
  if (semanticInsufficiency && artifact.canonicality.reasons.length === 0) {
    addIssue(
      ['canonicality'],
      'Incomplete pairs/mappings, noncanonical adjudication, unavailable metrics, or noncanonical bootstrap provenance require an insufficiency reason',
    );
  }

  const gateDefinitions = [
    {
      id: 'grounding-delta-upper-exclusive-zero' as const,
      comparator: '<' as const,
      threshold: HYDE_GATE_THRESHOLDS.groundingDeltaCiUpperExclusive,
      boundValue: artifact.metrics.groundingErrorRate.available
        ? artifact.metrics.groundingErrorRate.confidenceIntervals.delta.upper : null,
    },
    {
      id: 'frame-grounding-upper' as const,
      comparator: '<=' as const,
      threshold: HYDE_GATE_THRESHOLDS.frameGroundingCiUpperInclusive,
      boundValue: artifact.metrics.groundingErrorRate.available
        ? artifact.metrics.groundingErrorRate.confidenceIntervals.frameV1.upper : null,
    },
    {
      id: 'precision-at-5-delta-lower' as const,
      comparator: '>=' as const,
      threshold: HYDE_GATE_THRESHOLDS.precisionAt5DeltaCiLowerInclusive,
      boundValue: artifact.metrics.precisionAt5.available
        ? artifact.metrics.precisionAt5.confidenceIntervals.delta.lower : null,
    },
    {
      id: 'ndcg-at-5-delta-lower' as const,
      comparator: '>=' as const,
      threshold: HYDE_GATE_THRESHOLDS.ndcgAt5DeltaCiLowerInclusive,
      boundValue: artifact.metrics.ndcgAt5.available
        ? artifact.metrics.ndcgAt5.confidenceIntervals.delta.lower : null,
    },
    {
      id: 'margin-delta-lower' as const,
      comparator: '>=' as const,
      threshold: HYDE_GATE_THRESHOLDS.marginDeltaCiLowerInclusive,
      boundValue: artifact.metrics.margin.available
        ? artifact.metrics.margin.confidenceIntervals.delta.lower : null,
    },
    {
      id: 'hard-negative-fpr-delta-upper' as const,
      comparator: '<=' as const,
      threshold: HYDE_GATE_THRESHOLDS.hardNegativeFprDeltaCiUpperInclusive,
      boundValue: artifact.metrics.hardNegativeFprAt5.available
        ? artifact.metrics.hardNegativeFprAt5.confidenceIntervals.delta.upper : null,
    },
    {
      id: 'frame-all-rejected-upper' as const,
      comparator: '<=' as const,
      threshold: HYDE_GATE_THRESHOLDS.frameAllRejectedCiUpperInclusive,
      boundValue: artifact.metrics.frameAllRejectedRate.available
        ? artifact.metrics.frameAllRejectedRate.confidenceInterval.upper : null,
    },
    {
      id: 'frame-failed-open-upper' as const,
      comparator: '<=' as const,
      threshold: HYDE_GATE_THRESHOLDS.frameFailedOpenCiUpperInclusive,
      boundValue: artifact.metrics.frameFailedOpenRate.available
        ? artifact.metrics.frameFailedOpenRate.confidenceInterval.upper : null,
    },
  ];
  const globallyInsufficient = artifact.canonicality.status === 'insufficient'
    || artifact.canonicality.reasons.length > 0
    || semanticInsufficiency;
  for (const [index, definition] of gateDefinitions.entries()) {
    const record = artifact.gates.records[index];
    if (!record) continue;
    if (record.id !== definition.id) {
      addIssue(['gates', 'records', index, 'id'], 'Gate IDs must appear once in exact canonical order');
    }
    if (record.policyVersion !== HYDE_GATE_POLICY_VERSION
      || record.comparator !== definition.comparator
      || record.threshold !== definition.threshold) {
      addIssue(['gates', 'records', index], 'Gate policy version, comparator, and threshold must match committed policy');
    }
    if (record.boundValue !== definition.boundValue) {
      addIssue(['gates', 'records', index, 'boundValue'], 'Gate bound must exactly match its required metric confidence-interval bound');
    }
    const compare = definition.boundValue !== null
      && (definition.comparator === '<'
        ? definition.boundValue < definition.threshold
        : definition.comparator === '<='
          ? definition.boundValue <= definition.threshold
          : definition.boundValue >= definition.threshold);
    const expectedStatus = globallyInsufficient || definition.boundValue === null
      ? 'insufficient'
      : compare ? 'pass' : 'fail';
    if (record.status !== expectedStatus) {
      addIssue(['gates', 'records', index, 'status'], 'Gate status does not recompute from canonicality, metric availability, comparator, and bound');
    }
  }
  const gateIds = artifact.gates.records.map((record) => record.id);
  if (new Set(gateIds).size !== HYDE_GATE_IDS.length
    || gateIds.some((id, index) => id !== HYDE_GATE_IDS[index])) {
    addIssue(['gates', 'records'], 'Gate records must contain each exact policy gate once in canonical order');
  }
  const expectedOverall = artifact.gates.records.some((record) => record.status === 'insufficient')
    ? 'insufficient'
    : artifact.gates.records.every((record) => record.status === 'pass') ? 'pass' : 'fail';
  if (artifact.gates.overall !== expectedOverall) {
    addIssue(['gates', 'overall'], 'Gate overall status does not match gate records');
  }
  if ((semanticInsufficiency || artifact.canonicality.reasons.length > 0)
    && artifact.gates.overall !== 'insufficient') {
    addIssue(['gates', 'overall'], 'Semantically insufficient evidence cannot pass or fail release gates');
  }
});

export type HydeCollectionArtifact = z.infer<typeof HydeCollectionArtifactSchema>;
export type HydeCollectionSlot = z.infer<typeof HydeCollectionSlotSchema>;
export type HydeBlindPublicItem = z.infer<typeof HydeBlindPublicItemSchema>;
export type HydeBlindPublicBatch = z.infer<typeof HydeBlindPublicBatchSchema>;
export type HydeBlindPrivateMapping = z.infer<typeof HydeBlindPrivateMappingSchema>;
export type HydeBlindPrivateKey = z.infer<typeof HydeBlindPrivateKeySchema>;
export type HydeUnsupportedAddition = z.infer<typeof HydeUnsupportedAdditionSchema>;
export type HydeIndependentJudgment = z.infer<typeof HydeIndependentJudgmentSchema>;
export type HydeJudgmentArtifact = z.infer<typeof HydeJudgmentArtifactSchema>;
export type HydeResolverDecision = z.infer<typeof HydeResolverDecisionSchema>;
export type HydeResolverDecisionsArtifact = z.infer<typeof HydeResolverDecisionsArtifactSchema>;
export type HydeResolvedItem = z.infer<typeof HydeResolvedItemSchema>;
export type HydeResolvedAdjudicationArtifact = z.infer<typeof HydeResolvedAdjudicationArtifactSchema>;
export type HydePairedMetricAnalysis = z.infer<typeof HydePairedMetricAnalysisSchema>;
export type HydeScalarMetricAnalysis = z.infer<typeof HydeScalarMetricAnalysisSchema>;
export type HydeGateRecord = z.infer<typeof HydeGateRecordSchema>;
export type HydeAnalysisArtifact = z.infer<typeof HydeAnalysisArtifactSchema>;
