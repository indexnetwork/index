import { createHash } from 'node:crypto';
import path from 'node:path';

import { OpenAIEmbeddings } from '@langchain/openai';

import { HydeGenerator, type HydeGenerateInput, type HydeGeneratorOutput } from '../../src/shared/hyde/hyde.generator.js';
import { HydeGraphFactory, type HydeGeneratorLike, type HydeLensInferrerLike, type HydeValidatorLike } from '../../src/shared/hyde/hyde.graph.js';
import { HYDE_FRAME_GENERATION_VERSION, type HydeGenerationMode } from '../../src/shared/hyde/hyde.env.js';
import type { HydeDocumentState } from '../../src/shared/hyde/hyde.state.js';
import { HydeValidator, type HydeValidationInput, type HydeValidationOutput } from '../../src/shared/hyde/hyde.validator.js';
import { LensInferrer, type LensInferenceInput, type LensInferenceOutput } from '../../src/shared/hyde/lens.inferrer.js';
import type { HydeCache } from '../../src/shared/interfaces/cache.interface.js';
import type { CreateHydeDocumentData, HydeDocument, HydeGraphDatabase } from '../../src/shared/interfaces/database.interface.js';
import type { EmbeddingGenerateOptions, EmbeddingGenerator } from '../../src/shared/interfaces/embedder.interface.js';

import { fingerprintHydeArtifact } from './hyde.artifacts.js';
import { assertFrozenHydeCorpus, HYDE_CASES, HYDE_CORPUS_FINGERPRINT } from './hyde.cases.js';
import { analyzeGeneratedDocuments } from './hyde.diagnostics.js';
import { HYDE_ARTIFACT_SCHEMA_VERSION, HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING, HYDE_BACKGROUND_SOURCES, HYDE_BOOTSTRAP_SEED, HYDE_CANONICAL_EMBEDDING_PIN, HYDE_CANONICAL_FRAME_GENERATION_VERSION, HYDE_CANONICAL_MODEL_PINS, HYDE_CANONICAL_PROVENANCE_PINS, HYDE_CANONICAL_RUNS, HYDE_CORPUS_VERSION, HYDE_EXECUTION_SEED, HYDE_EXPECTED_CASE_COUNT, HYDE_GATE_POLICY_VERSION, HYDE_LENS_BONUS, HYDE_MAX_LENSES, HYDE_MIN_SCORE, HYDE_RUBRIC_VERSION } from './hyde.policy.js';
import { getHydeEvalModelMetadata, readGitMetadata } from './hyde.report.js';
import { HYDE_COLLECTION_ARTIFACT_TYPE, HydeCollectionArtifactSchema, HydeEvalRunResultSchema, type HydeCollectionArtifact, type HydeCollectionSlot } from './hyde.schemas.js';
import { scoreAllCandidates, type HydeRankingOptions } from './hyde.scorer.js';
import type { EmbeddedCandidate, HydeEvalCase, HydeEvalGitMetadata, HydeEvalGraphSourceType, HydeEvalModelMetadata, HydeEvalRunResult, HydeResourceCallDiagnostic, HydeRunResourceDiagnostics, LensQueryEmbedding, RankedCandidate } from './hyde.types.js';

export const HYDE_EVAL_EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'openai/text-embedding-3-large';
export const HYDE_EVAL_EMBEDDING_DIMENSIONS = process.env.EMBEDDING_DIMENSIONS
  ? Number.parseInt(process.env.EMBEDDING_DIMENSIONS, 10)
  : 2000;
export const HYDE_EVAL_EMBEDDING_BASE_URL = 'https://openrouter.ai/api/v1';

export interface HydeCollectionEmbeddingMetadata {
  baseUrl: string;
  model: string;
  dimensions: number;
  encodingFormat: 'float';
}

/** Read the effective production embedding configuration at collection time. */
export function getConfiguredHydeEvalEmbeddingMetadata(): HydeCollectionEmbeddingMetadata {
  return {
    baseUrl: HYDE_EVAL_EMBEDDING_BASE_URL,
    model: process.env.EMBEDDING_MODEL ?? HYDE_CANONICAL_EMBEDDING_PIN.model,
    dimensions: process.env.EMBEDDING_DIMENSIONS
      ? Number.parseInt(process.env.EMBEDDING_DIMENSIONS, 10)
      : HYDE_CANONICAL_EMBEDDING_PIN.dimensions,
    encodingFormat: 'float',
  };
}

export interface CounterbalancedScheduleEntry {
  caseId: string;
  run: number;
  caseRunHash: string;
  executionOrdinal: number;
  modeOrder: ['legacy', 'frame-v1'] | ['frame-v1', 'legacy'];
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function caseRunHash(executionSeed: number, caseId: string, run: number): string {
  return createHash('sha256')
    .update(String(executionSeed))
    .update('\0')
    .update(caseId)
    .update('\0')
    .update(String(run))
    .digest('hex');
}

/**
 * Build an exact per-case AB/BA schedule and then globally order all pair blocks
 * by their committed seed-derived case/run hash.
 */
export function buildCounterbalancedSchedule(
  caseIds: readonly string[],
  runs: number = HYDE_CANONICAL_RUNS,
  executionSeed: number = HYDE_EXECUTION_SEED,
): CounterbalancedScheduleEntry[] {
  if (caseIds.length === 0) throw new Error('At least one case is required for a HyDE schedule');
  if (new Set(caseIds).size !== caseIds.length) throw new Error('HyDE schedule case IDs must be unique');
  if (!Number.isInteger(runs) || runs < 1 || runs % 2 !== 0) {
    throw new Error(`HyDE counterbalancing requires a positive even run count (got ${runs})`);
  }
  if (!Number.isInteger(executionSeed)) throw new Error('HyDE execution seed must be an integer');

  const half = runs / 2;
  const entries = caseIds.flatMap((caseId) => {
    const perCase = Array.from({ length: runs }, (_, index) => {
      const run = index + 1;
      return { caseId, run, caseRunHash: caseRunHash(executionSeed, caseId, run) };
    }).sort((left, right) =>
      compareAscii(left.caseRunHash, right.caseRunHash) || left.run - right.run);

    return perCase.map((entry, index) => ({
      ...entry,
      modeOrder: index < half
        ? ['legacy', 'frame-v1'] as ['legacy', 'frame-v1']
        : ['frame-v1', 'legacy'] as ['frame-v1', 'legacy'],
    }));
  }).sort((left, right) =>
    compareAscii(left.caseRunHash, right.caseRunHash)
      || compareAscii(left.caseId, right.caseId)
      || left.run - right.run);

  return entries.map((entry, executionOrdinal) => ({ ...entry, executionOrdinal }));
}

/** LangChain wrapper configured to match the API adapter's OpenRouter embedding setup. */
export function createHydeEvalEmbedder(): EmbeddingGenerator {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for the live HyDE retrieval eval');
  const embedding = getConfiguredHydeEvalEmbeddingMetadata();
  if (!Number.isInteger(embedding.dimensions) || embedding.dimensions < 1) {
    throw new Error(`EMBEDDING_DIMENSIONS must be a positive integer (got ${process.env.EMBEDDING_DIMENSIONS})`);
  }

  const client = new OpenAIEmbeddings({
    apiKey,
    model: embedding.model,
    dimensions: embedding.dimensions,
    encodingFormat: embedding.encodingFormat,
    configuration: {
      baseURL: embedding.baseUrl,
      defaultHeaders: {
        'HTTP-Referer': 'https://index.network',
        'X-Title': 'Index Network',
      },
    },
  });

  return {
    async generate(text: string | string[]): Promise<number[] | number[][]> {
      return Array.isArray(text) ? client.embedDocuments(text) : client.embedQuery(text);
    },
  };
}

class EmptyCache implements HydeCache {
  async get<_T>(): Promise<_T | null> { return null; }
  async set<_T>(): Promise<void> {}
  async delete(): Promise<boolean> { return false; }
  async exists(): Promise<boolean> { return false; }
}

function memoryDatabase(): HydeGraphDatabase {
  return {
    async getHydeDocument(): Promise<HydeDocument | null> { return null; },
    async getHydeDocumentsForSource(): Promise<HydeDocument[]> { return []; },
    async saveHydeDocument(data: CreateHydeDocumentData): Promise<HydeDocument> {
      return {
        id: 'eval-only',
        sourceType: data.sourceType,
        sourceId: data.sourceId ?? null,
        sourceText: data.sourceText ?? null,
        strategy: data.strategy,
        targetCorpus: data.targetCorpus,
        hydeText: data.hydeText,
        hydeEmbedding: data.hydeEmbedding,
        context: data.context ?? null,
        createdAt: new Date(0),
        expiresAt: data.expiresAt ?? null,
      };
    },
    async getIntent() { return null; },
  };
}

export type HydeCollectionFailureStage =
  | 'embedding'
  | 'lens-inference'
  | 'generation'
  | 'validation'
  | 'graph'
  | 'ranking'
  | 'collection';

class HydeRunStageError extends Error {
  constructor(readonly stage: HydeCollectionFailureStage, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'HydeRunStageError';
  }
}

/** Eval-local failure carrying wrapper calls recorded before a run aborted. */
export class HydeEvalRunError extends Error {
  constructor(
    readonly stage: HydeCollectionFailureStage,
    cause: unknown,
    readonly resources: HydeRunResourceDiagnostics,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'HydeEvalRunError';
  }
}

interface TimedCall {
  durationMs: number;
  inputCount: number;
  outcome: 'completed' | 'threw';
}

export interface GeneratedCall {
  input: HydeGenerateInput;
  output?: HydeGeneratorOutput;
  timing: TimedCall;
}

/** Eval-local wrapper that records calls and can await all concurrent delegates. */
export class RecordingGenerator implements HydeGeneratorLike {
  readonly calls: GeneratedCall[] = [];
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly delegate: HydeGeneratorLike) {}

  async generate(input: HydeGenerateInput): Promise<HydeGeneratorOutput> {
    const started = performance.now();
    let markSettled: (() => void) | undefined;
    const settled = new Promise<void>((resolve) => { markSettled = resolve; });
    this.inFlight.add(settled);
    try {
      const output = await this.delegate.generate(input);
      this.calls.push({
        input,
        output,
        timing: { durationMs: performance.now() - started, inputCount: 1, outcome: 'completed' },
      });
      return output;
    } catch (error) {
      this.calls.push({
        input,
        timing: { durationMs: performance.now() - started, inputCount: 1, outcome: 'threw' },
      });
      throw new HydeRunStageError('generation', error);
    } finally {
      this.inFlight.delete(settled);
      markSettled?.();
    }
  }

  /** Wait for every generator call already started by the production graph. */
  async awaitSettled(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }
}

interface ValidationCall {
  input: HydeValidationInput;
  output?: HydeValidationOutput;
  error?: string;
  timing: TimedCall;
}

class RecordingValidator implements HydeValidatorLike {
  readonly calls: ValidationCall[] = [];

  constructor(private readonly delegate: HydeValidator) {}

  async validate(input: HydeValidationInput): Promise<HydeValidationOutput> {
    const started = performance.now();
    try {
      const output = await this.delegate.validate(input);
      this.calls.push({
        input,
        output,
        timing: {
          durationMs: performance.now() - started,
          inputCount: Object.keys(input.documents).length,
          outcome: 'completed',
        },
      });
      return output;
    } catch (error) {
      this.calls.push({
        input,
        error: safeErrorMessage(error),
        timing: {
          durationMs: performance.now() - started,
          inputCount: Object.keys(input.documents).length,
          outcome: 'threw',
        },
      });
      // The production graph catches this and records failed-open documents.
      throw error;
    }
  }
}

class RecordingLensInferrer implements HydeLensInferrerLike {
  readonly calls: TimedCall[] = [];

  constructor(private readonly delegate: LensInferrer) {}

  async infer(input: LensInferenceInput): Promise<LensInferenceOutput> {
    const started = performance.now();
    try {
      const output = await this.delegate.infer(input);
      this.calls.push({ durationMs: performance.now() - started, inputCount: 1, outcome: 'completed' });
      return output;
    } catch (error) {
      this.calls.push({ durationMs: performance.now() - started, inputCount: 1, outcome: 'threw' });
      throw new HydeRunStageError('lens-inference', error);
    }
  }
}

class RecordingEmbedder implements EmbeddingGenerator {
  readonly calls: TimedCall[] = [];

  constructor(private readonly delegate: EmbeddingGenerator) {}

  async generate(
    text: string | string[],
    dimensions?: number,
    options?: EmbeddingGenerateOptions,
  ): Promise<number[] | number[][]> {
    const started = performance.now();
    const inputCount = Array.isArray(text) ? text.length : 1;
    try {
      const output = await this.delegate.generate(text, dimensions, options);
      this.calls.push({ durationMs: performance.now() - started, inputCount, outcome: 'completed' });
      return output;
    } catch (error) {
      this.calls.push({ durationMs: performance.now() - started, inputCount, outcome: 'threw' });
      throw new HydeRunStageError('embedding', error);
    }
  }
}

function resourceCalls(calls: readonly TimedCall[]): HydeResourceCallDiagnostic[] {
  return calls.map((call) => ({ ...call }));
}

function recordedRunResources(
  inferrer: RecordingLensInferrer,
  generator: RecordingGenerator,
  validator: RecordingValidator | undefined,
  embedder: RecordingEmbedder,
): HydeRunResourceDiagnostics {
  return {
    lensInferenceCalls: resourceCalls(inferrer.calls),
    generatorCalls: resourceCalls(generator.calls.map((call) => call.timing)),
    validatorCalls: resourceCalls(validator?.calls.map((call) => call.timing) ?? []),
    documentEmbeddingCalls: resourceCalls(embedder.calls),
  };
}

export async function embedCandidates(
  c: HydeEvalCase,
  embedder: EmbeddingGenerator,
): Promise<EmbeddedCandidate[]> {
  const embeddings = await embedder.generate(c.candidates.map((candidate) => candidate.text));
  if (!Array.isArray(embeddings[0])) throw new Error(`Candidate embedding batch failed for ${c.id}`);
  const vectors = embeddings as number[][];
  if (vectors.length !== c.candidates.length) {
    throw new Error(`Candidate embedding count mismatch for ${c.id}`);
  }
  return c.candidates.map((candidate, index) => ({ ...candidate, embedding: vectors[index] }));
}

/** Map the product-level background source to the current internal HyDE graph branch. */
export function graphSourceTypeForHydeCase(c: HydeEvalCase): HydeEvalGraphSourceType {
  return HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING[c.backgroundSource];
}

/** Stable eval-only identity for the persisted source represented by a case. */
export function sourceIdForHydeCase(c: HydeEvalCase): string {
  return `hyde-eval/${c.backgroundSource}/${c.id}`;
}

/**
 * Reproduce the saved-intent background path's discoverer-context shape.
 * The trigger intent is always one of the active intents in production; an
 * authored profile sentence represents the global user-context paragraph.
 */
export function discovererContextForHydeCase(c: HydeEvalCase): string | undefined {
  if (c.backgroundSource !== 'saved-intent') return undefined;
  const lines: string[] = [];
  if (c.profileContext) lines.push(`Context: ${c.profileContext}`);
  lines.push('', 'Active intents:', `- ${c.sourceText}`);
  return lines.join('\n');
}

/** Build the source identity passed to the production graph by one eval case. */
export function hydeGraphInputForCase(c: HydeEvalCase, maxLenses: number) {
  const profileContext = discovererContextForHydeCase(c);
  return {
    sourceType: graphSourceTypeForHydeCase(c),
    sourceId: sourceIdForHydeCase(c),
    sourceText: c.sourceText,
    ...(profileContext ? { profileContext } : {}),
    maxLenses,
    forceRegenerate: true as const,
  };
}

/** Execute one real production graph run with empty database/cache adapters. */
export async function runHydeCase(
  c: HydeEvalCase,
  mode: HydeGenerationMode,
  run: number,
  embedder: EmbeddingGenerator,
  candidates: EmbeddedCandidate[],
  rankingOptions: HydeRankingOptions = {},
  maxLenses: number = HYDE_MAX_LENSES,
): Promise<HydeEvalRunResult> {
  const inferrer = new RecordingLensInferrer(new LensInferrer());
  const generator = new RecordingGenerator(new HydeGenerator());
  const validator = mode === 'frame-v1' ? new RecordingValidator(new HydeValidator()) : undefined;
  const graphEmbedder = new RecordingEmbedder(embedder);
  const graph = new HydeGraphFactory(
    memoryDatabase(),
    graphEmbedder,
    new EmptyCache(),
    inferrer,
    generator,
    { mode, ...(validator ? { validator } : {}) },
  ).createGraph();

  let result: Awaited<ReturnType<typeof graph.invoke>>;
  try {
    result = await graph.invoke(hydeGraphInputForCase(c, maxLenses));
  } catch (error) {
    // LangGraph may reject Promise.all on the first per-lens failure while sibling
    // generator calls remain active. Drain them before freezing this slot's resources
    // so they cannot disappear from diagnostics or overlap the next mode.
    await generator.awaitSettled();
    throw new HydeEvalRunError(
      error instanceof HydeRunStageError ? error.stage : 'graph',
      error,
      recordedRunResources(inferrer, generator, validator, graphEmbedder),
    );
  }

  const returned = result.hydeDocuments as Record<string, HydeDocumentState>;
  const queryEmbeddings = Object.entries(returned)
    .filter(([, document]) => document.hydeEmbedding.length > 0)
    .map(([lensId, document]): LensQueryEmbedding => ({
      lensId,
      corpus: document.targetCorpus,
      embedding: document.hydeEmbedding,
    }));

  let allCandidateScores: ReturnType<typeof scoreAllCandidates>;
  try {
    allCandidateScores = scoreAllCandidates(queryEmbeddings, candidates, rankingOptions);
  } catch (error) {
    throw new HydeEvalRunError(
      'ranking',
      error,
      recordedRunResources(inferrer, generator, validator, graphEmbedder),
    );
  }
  const ranking = allCandidateScores
    .filter((candidate): candidate is RankedCandidate => candidate.qualified)
    .sort((left, right) => right.score - left.score);

  const validationCall = validator?.calls[0];
  const completedGeneratorCalls = generator.calls.filter(
    (generated): generated is GeneratedCall & { output: HydeGeneratorOutput } => generated.output !== undefined,
  );
  const diagnostics = analyzeGeneratedDocuments(
    mode,
    completedGeneratorCalls.map((generated) => ({
      lens: generated.input.lens,
      corpus: generated.input.corpus,
      text: generated.output.text,
    })),
    returned,
    validationCall
      ? {
        documents: validationCall.input.documents,
        ...(validationCall.output ? { verdicts: validationCall.output.verdicts } : {}),
        ...(validationCall.error ? { error: validationCall.error } : {}),
      }
      : undefined,
  );

  return {
    caseId: c.id,
    mode,
    run,
    allCandidateScores,
    ranking,
    lensCount: result.lenses.length,
    returnedDocumentCount: Object.keys(returned).length,
    generatedDocumentCount: generator.calls.length,
    overwrittenDocumentCount: diagnostics.overwrittenDocumentCount,
    validatorSubmittedDocumentCount: diagnostics.validatorSubmittedDocumentCount,
    rejectedCount: mode === 'frame-v1' ? diagnostics.rejectedCount : null,
    failedOpenCount: diagnostics.failedOpenCount,
    documents: diagnostics.documents,
    resources: recordedRunResources(inferrer, generator, validator, graphEmbedder),
  };
}

export interface HydeRunExecutionInput {
  case: HydeEvalCase;
  mode: HydeGenerationMode;
  run: number;
  embedder: EmbeddingGenerator;
  candidates: EmbeddedCandidate[];
  rankingOptions: HydeRankingOptions;
  maxLenses: number;
}

export type HydeRunExecutor = (input: HydeRunExecutionInput) => Promise<HydeEvalRunResult>;

export interface HydeCollectionProgress {
  completedOperations: number;
  totalOperations: number;
  phase: 'candidate-embedding' | 'mode-run';
  caseId: string;
  run?: number;
  mode?: HydeGenerationMode;
  status: 'completed' | 'failed';
}

export interface CollectHydeEvidenceOptions {
  selectedCaseIds?: readonly string[];
  runs?: number;
  cutoff?: number;
  lensBonus?: number;
  maxLenses?: number;
  executionSeed?: number;
  bootstrapSeed?: number;
  studyId?: string;
  embedder?: EmbeddingGenerator;
  runExecutor?: HydeRunExecutor;
  git?: HydeEvalGitMetadata;
  models?: HydeEvalModelMetadata;
  embedding?: HydeCollectionEmbeddingMetadata;
  generationVersion?: string;
  repoRoot?: string;
  now?: () => Date;
  monotonicNow?: () => number;
  onProgress?: (progress: HydeCollectionProgress) => void;
  additionalNoncanonicalReasons?: readonly string[];
}

interface OperationTiming {
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

async function timeOperation<T>(
  operation: () => Promise<T>,
  now: () => Date,
  monotonicNow: () => number,
): Promise<{ timing: OperationTiming; value?: T; error?: unknown }> {
  const startedAt = now().toISOString();
  const started = monotonicNow();
  try {
    const value = await operation();
    return {
      value,
      timing: {
        startedAt,
        completedAt: now().toISOString(),
        durationMs: Math.max(0, monotonicNow() - started),
      },
    };
  } catch (error) {
    return {
      error,
      timing: {
        startedAt,
        completedAt: now().toISOString(),
        durationMs: Math.max(0, monotonicNow() - started),
      },
    };
  }
}

function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = raw
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|key)-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\b(api[_-]?key|authorization|token|secret)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/\s+/g, ' ')
    .trim();
  return (redacted || 'Unknown collection error').slice(0, 500);
}

type HydeCollectionFailureCode =
  | 'embedding_error'
  | 'lens_inference_error'
  | 'generation_error'
  | 'validation_error'
  | 'graph_error'
  | 'ranking_error'
  | 'collection_error'
  | 'unknown';

type HydeFailedCollectionSlot = Extract<HydeCollectionSlot, { status: 'failed' }>;

function failureCode(stage: HydeCollectionFailureStage): HydeCollectionFailureCode {
  const codes: Record<HydeCollectionFailureStage, HydeCollectionFailureCode> = {
    embedding: 'embedding_error',
    'lens-inference': 'lens_inference_error',
    generation: 'generation_error',
    validation: 'validation_error',
    graph: 'graph_error',
    ranking: 'ranking_error',
    collection: 'collection_error',
  };
  return codes[stage];
}

function failedSlot(error: unknown, timing: OperationTiming, fallbackStage: HydeCollectionFailureStage): HydeFailedCollectionSlot {
  const stage = error instanceof HydeEvalRunError || error instanceof HydeRunStageError
    ? error.stage
    : fallbackStage;
  return {
    status: 'failed',
    failure: {
      code: failureCode(stage),
      stage,
      message: safeErrorMessage(error),
      retryable: false,
    },
    timing,
    ...(error instanceof HydeEvalRunError ? { resources: error.resources } : {}),
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return fingerprintHydeArtifact(left) === fingerprintHydeArtifact(right);
}

function canonicalityReasons(input: {
  git: HydeEvalGitMetadata;
  models: HydeEvalModelMetadata;
  embedding: HydeCollectionEmbeddingMetadata;
  generationVersion: string;
  selectedCaseIds: string[];
  runs: number;
  cutoff: number;
  lensBonus: number;
  maxLenses: number;
  executionSeed: number;
  bootstrapSeed: number;
  injectedEmbedder: boolean;
  injectedRunExecutor: boolean;
  injectedGit: boolean;
  injectedModels: boolean;
  injectedEmbeddingMetadata: boolean;
  injectedGenerationVersion: boolean;
}): string[] {
  const reasons: string[] = [];
  if (input.git.revision === 'unknown') reasons.push('git revision is unknown');
  else if (!/^[a-f0-9]{40,64}$/i.test(input.git.revision)) reasons.push('git revision is not a commit hash');
  if (input.git.dirty === null) reasons.push('git dirty state is unknown');
  if (input.git.dirty === true) reasons.push('git worktree is dirty');
  if (input.git.dirty !== null) {
    const expectedMarker = `${input.git.revision}${input.git.dirty ? '-dirty' : ''}`;
    if (input.git.revisionWithDirtyMarker !== expectedMarker) reasons.push('git provenance marker is inconsistent');
  }
  if (!sameJson(input.selectedCaseIds, HYDE_CASES.map((c) => c.id))) {
    reasons.push(`selected cases differ from the canonical ordered ${HYDE_EXPECTED_CASE_COUNT}-case corpus`);
  }
  if (input.runs !== HYDE_CANONICAL_RUNS) reasons.push('run count differs from canonical config');
  if (input.cutoff !== HYDE_MIN_SCORE) reasons.push('ranking cutoff differs from canonical config');
  if (input.lensBonus !== HYDE_LENS_BONUS) reasons.push('lens bonus differs from canonical config');
  if (input.maxLenses !== HYDE_MAX_LENSES) reasons.push('max lenses differs from canonical config');
  if (input.executionSeed !== HYDE_EXECUTION_SEED) reasons.push('execution seed differs from canonical config');
  if (input.bootstrapSeed !== HYDE_BOOTSTRAP_SEED) reasons.push('bootstrap seed differs from canonical config');
  if (!sameJson(input.models, HYDE_CANONICAL_MODEL_PINS)) reasons.push('configured primary model provenance differs from committed canonical pins');
  if (!sameJson(input.embedding, HYDE_CANONICAL_EMBEDDING_PIN)) reasons.push('configured primary embedding provenance differs from committed canonical pins');
  if (input.generationVersion !== HYDE_CANONICAL_FRAME_GENERATION_VERSION) reasons.push('generation version differs from the committed canonical frame version');
  if (input.injectedEmbedder) reasons.push('embedding executor was injected instead of constructed from production config');
  if (input.injectedRunExecutor) reasons.push('run executor was injected instead of using the production graph');
  if (input.injectedGit) reasons.push('git provenance metadata was caller-provided instead of read from the collection environment');
  if (input.injectedModels) reasons.push('configured primary model provenance was caller-provided instead of read from production model config');
  if (input.injectedEmbeddingMetadata) reasons.push('configured primary embedding provenance was caller-provided instead of read from production embedding config');
  if (input.injectedGenerationVersion) reasons.push('generation version provenance was caller-provided instead of read from production HyDE config');
  return reasons;
}

/**
 * Collect the complete paired evidence boundary. Every selected case/run has two
 * explicit slots; mode and candidate-embedding failures are never retried or omitted.
 */
export async function collectHydeEvidence(
  options: CollectHydeEvidenceOptions = {},
): Promise<HydeCollectionArtifact> {
  assertFrozenHydeCorpus(HYDE_CASES);

  const selectedCaseIds = [...(options.selectedCaseIds ?? HYDE_CASES.map((c) => c.id))];
  if (selectedCaseIds.length === 0 || new Set(selectedCaseIds).size !== selectedCaseIds.length) {
    throw new Error('Selected HyDE case IDs must be non-empty and unique');
  }
  const casesById = new Map(HYDE_CASES.map((c) => [c.id, c]));
  const selectedCases = selectedCaseIds.map((caseId) => {
    const c = casesById.get(caseId);
    if (!c) throw new Error(`Unknown frozen HyDE case ID: ${caseId}`);
    return c;
  });

  const runs = options.runs ?? HYDE_CANONICAL_RUNS;
  const cutoff = options.cutoff ?? HYDE_MIN_SCORE;
  const lensBonus = options.lensBonus ?? HYDE_LENS_BONUS;
  const maxLenses = options.maxLenses ?? HYDE_MAX_LENSES;
  const executionSeed = options.executionSeed ?? HYDE_EXECUTION_SEED;
  const bootstrapSeed = options.bootstrapSeed ?? HYDE_BOOTSTRAP_SEED;
  if (!Number.isFinite(cutoff) || cutoff < 0 || cutoff > 1) {
    throw new Error(`HyDE cutoff must be finite and between zero and one (got ${cutoff})`);
  }
  if (!Number.isFinite(lensBonus) || lensBonus < 0) {
    throw new Error(`HyDE lens bonus must be finite and non-negative (got ${lensBonus})`);
  }
  if (!Number.isInteger(maxLenses) || maxLenses < 1) {
    throw new Error(`HyDE max lenses must be a positive integer (got ${maxLenses})`);
  }
  if (!Number.isInteger(bootstrapSeed)) throw new Error('HyDE bootstrap seed must be an integer');

  const schedule = buildCounterbalancedSchedule(selectedCaseIds, runs, executionSeed);
  const embedder = options.embedder ?? createHydeEvalEmbedder();
  const runExecutor = options.runExecutor ?? ((input: HydeRunExecutionInput) => runHydeCase(
    input.case,
    input.mode,
    input.run,
    input.embedder,
    input.candidates,
    input.rankingOptions,
    input.maxLenses,
  ));
  const now = options.now ?? (() => new Date());
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const models = options.models ?? getHydeEvalModelMetadata();
  const embedding = options.embedding ?? getConfiguredHydeEvalEmbeddingMetadata();
  if (!Number.isInteger(embedding.dimensions) || embedding.dimensions < 1) {
    throw new Error(`HyDE embedding dimensions must be a positive integer (got ${embedding.dimensions})`);
  }
  const generationVersion = options.generationVersion ?? HYDE_FRAME_GENERATION_VERSION;
  const git = options.git ?? readGitMetadata(
    options.repoRoot ?? path.resolve(import.meta.dir, '../../../..'),
  );
  const collectionStartedAt = now().toISOString();
  const totalOperations = selectedCases.length + schedule.length * 2;
  let completedOperations = 0;
  const notifyProgress = (progress: Omit<HydeCollectionProgress, 'completedOperations' | 'totalOperations'>): void => {
    completedOperations += 1;
    try {
      options.onProgress?.({ ...progress, completedOperations, totalOperations });
    } catch {
      // Progress observers are diagnostic only and cannot change collection semantics.
    }
  };

  const embeddedByCase = new Map<string, EmbeddedCandidate[]>();
  const embeddingFailureByCase = new Map<string, { error: unknown; timing: OperationTiming }>();
  const candidateEmbeddingSetups: HydeCollectionArtifact['candidateEmbeddingSetups'] = [];
  for (const c of selectedCases) {
    const candidatePoolFingerprint = fingerprintHydeArtifact(c.candidates);
    const operation = await timeOperation(
      () => embedCandidates(c, embedder),
      now,
      monotonicNow,
    );
    if (operation.error !== undefined || operation.value === undefined) {
      const error = operation.error ?? new Error('Candidate embedding returned no value');
      embeddingFailureByCase.set(c.id, { error, timing: operation.timing });
      candidateEmbeddingSetups.push({
        caseId: c.id,
        status: 'failed',
        ...operation.timing,
        inputCount: c.candidates.length,
        candidatePoolFingerprint,
        failure: failedSlot(error, operation.timing, 'embedding').failure,
      });
      notifyProgress({ phase: 'candidate-embedding', caseId: c.id, status: 'failed' });
    } else {
      embeddedByCase.set(c.id, operation.value);
      candidateEmbeddingSetups.push({
        caseId: c.id,
        status: 'completed',
        ...operation.timing,
        inputCount: c.candidates.length,
        candidatePoolFingerprint,
      });
      notifyProgress({ phase: 'candidate-embedding', caseId: c.id, status: 'completed' });
    }
  }

  const pairedBlocks: HydeCollectionArtifact['pairedBlocks'] = [];
  for (const entry of schedule) {
    const c = casesById.get(entry.caseId);
    if (!c) throw new Error(`Scheduled unknown frozen HyDE case ID: ${entry.caseId}`);
    const candidateFailure = embeddingFailureByCase.get(c.id);
    if (candidateFailure) {
      const legacy = failedSlot(candidateFailure.error, candidateFailure.timing, 'embedding');
      const frameV1 = failedSlot(candidateFailure.error, candidateFailure.timing, 'embedding');
      pairedBlocks.push({
        caseId: c.id,
        stratum: c.stratum,
        backgroundSource: c.backgroundSource,
        graphSourceType: graphSourceTypeForHydeCase(c),
        run: entry.run,
        executionOrdinal: entry.executionOrdinal,
        modeOrder: entry.modeOrder,
        legacy,
        frameV1,
      });
      for (const mode of entry.modeOrder) {
        notifyProgress({ phase: 'mode-run', caseId: c.id, run: entry.run, mode, status: 'failed' });
      }
      continue;
    }

    const candidates = embeddedByCase.get(c.id);
    if (!candidates) throw new Error(`Missing candidate embedding outcome for ${c.id}`);
    const slots = new Map<HydeGenerationMode, HydeCollectionSlot>();
    for (const mode of entry.modeOrder) {
      const operation = await timeOperation(
        () => runExecutor({
          case: c,
          mode,
          run: entry.run,
          embedder,
          candidates,
          rankingOptions: { minScore: cutoff, lensBonusPerAdditionalMatch: lensBonus },
          maxLenses,
        }),
        now,
        monotonicNow,
      );
      if (operation.error !== undefined || operation.value === undefined) {
        slots.set(mode, failedSlot(operation.error ?? new Error('Run executor returned no value'), operation.timing, 'graph'));
        notifyProgress({ phase: 'mode-run', caseId: c.id, run: entry.run, mode, status: 'failed' });
        continue;
      }
      try {
        const result = HydeEvalRunResultSchema.parse(operation.value);
        slots.set(mode, { status: 'completed', result, timing: operation.timing });
        notifyProgress({ phase: 'mode-run', caseId: c.id, run: entry.run, mode, status: 'completed' });
      } catch (error) {
        slots.set(mode, failedSlot(error, operation.timing, 'collection'));
        notifyProgress({ phase: 'mode-run', caseId: c.id, run: entry.run, mode, status: 'failed' });
      }
    }

    const legacy = slots.get('legacy');
    const frameV1 = slots.get('frame-v1');
    if (!legacy || !frameV1) throw new Error(`Internal schedule did not execute both modes for ${c.id} run ${entry.run}`);
    pairedBlocks.push({
      caseId: c.id,
      stratum: c.stratum,
      backgroundSource: c.backgroundSource,
      graphSourceType: graphSourceTypeForHydeCase(c),
      run: entry.run,
      executionOrdinal: entry.executionOrdinal,
      modeOrder: entry.modeOrder,
      legacy,
      frameV1,
    });
  }

  const config = {
    selectedCaseIds,
    runs,
    cutoff,
    lensBonus,
    maxLenses,
    seeds: { execution: executionSeed, bootstrap: bootstrapSeed },
  };
  const backgroundSourceGraphMapping = HYDE_BACKGROUND_SOURCES.map((backgroundSource) => ({
    backgroundSource,
    graphSourceType: HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING[backgroundSource],
  })) as [
    { backgroundSource: 'saved-intent'; graphSourceType: 'query' },
    { backgroundSource: 'user-context'; graphSourceType: 'context' },
  ];
  const provenance = { git, models, embedding, generationVersion, backgroundSourceGraphMapping };
  const configFingerprint = fingerprintHydeArtifact({
    policyVersion: HYDE_GATE_POLICY_VERSION,
    config,
    policyPins: HYDE_CANONICAL_PROVENANCE_PINS,
    models,
    embedding,
    generationVersion,
    backgroundSourceGraphMapping,
    schedule: schedule.map(({ caseId, run, caseRunHash: hash, modeOrder }) => ({ caseId, run, hash, modeOrder })),
  });
  const reasons = canonicalityReasons({
    git,
    models,
    embedding,
    generationVersion,
    selectedCaseIds,
    runs,
    cutoff,
    lensBonus,
    maxLenses,
    executionSeed,
    bootstrapSeed,
    injectedEmbedder: options.embedder !== undefined,
    injectedRunExecutor: options.runExecutor !== undefined,
    injectedGit: options.git !== undefined,
    injectedModels: options.models !== undefined,
    injectedEmbeddingMetadata: options.embedding !== undefined,
    injectedGenerationVersion: options.generationVersion !== undefined,
  });
  reasons.push(...(options.additionalNoncanonicalReasons ?? []));
  if (candidateEmbeddingSetups.some((setup) => setup.status === 'failed')) {
    reasons.push('candidate embedding setup contains explicit failures');
  }
  if (pairedBlocks.some((block) => block.legacy.status === 'failed' || block.frameV1.status === 'failed')) {
    reasons.push('paired evidence contains explicit failed slots');
  }

  const completedAt = now().toISOString();
  const studyId = options.studyId ?? `hyde-evidence-${fingerprintHydeArtifact({
    corpus: HYDE_CORPUS_FINGERPRINT,
    config: configFingerprint,
    startedAt: collectionStartedAt,
  }).slice(0, 20)}`;
  return HydeCollectionArtifactSchema.parse({
    artifactType: HYDE_COLLECTION_ARTIFACT_TYPE,
    schemaVersion: HYDE_ARTIFACT_SCHEMA_VERSION,
    policyVersion: HYDE_GATE_POLICY_VERSION,
    corpusVersion: HYDE_CORPUS_VERSION,
    rubricVersion: HYDE_RUBRIC_VERSION,
    studyId,
    createdAt: completedAt,
    corpusFingerprint: HYDE_CORPUS_FINGERPRINT,
    configFingerprint,
    provenance,
    canonicality: { candidate: reasons.length === 0, reasons },
    config,
    candidateEmbeddingSetups,
    pairedBlocks,
  });
}
