import { OpenAIEmbeddings } from '@langchain/openai';

import { HydeGenerator, type HydeGenerateInput, type HydeGeneratorOutput } from '../../src/shared/hyde/hyde.generator.js';
import { HydeGraphFactory, type HydeGeneratorLike, type HydeValidatorLike } from '../../src/shared/hyde/hyde.graph.js';
import type { HydeGenerationMode } from '../../src/shared/hyde/hyde.env.js';
import type { HydeDocumentState } from '../../src/shared/hyde/hyde.state.js';
import { HydeValidator, type HydeValidationInput, type HydeValidationOutput } from '../../src/shared/hyde/hyde.validator.js';
import { LensInferrer } from '../../src/shared/hyde/lens.inferrer.js';
import type { HydeCache } from '../../src/shared/interfaces/cache.interface.js';
import type { CreateHydeDocumentData, HydeDocument, HydeGraphDatabase } from '../../src/shared/interfaces/database.interface.js';
import type { EmbeddingGenerator } from '../../src/shared/interfaces/embedder.interface.js';

import { analyzeGeneratedDocuments } from './hyde.diagnostics.js';
import { expectedTargetRank, rankCandidates, type HydeRankingOptions } from './hyde.scorer.js';
import type { EmbeddedCandidate, HydeEvalCase, HydeEvalRunResult, LensQueryEmbedding } from './hyde.types.js';

export const HYDE_EVAL_EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'openai/text-embedding-3-large';
export const HYDE_EVAL_EMBEDDING_DIMENSIONS = process.env.EMBEDDING_DIMENSIONS
  ? Number.parseInt(process.env.EMBEDDING_DIMENSIONS, 10)
  : 2000;
export const HYDE_EVAL_EMBEDDING_BASE_URL = 'https://openrouter.ai/api/v1';

/** LangChain wrapper configured to match the API adapter's OpenRouter embedding setup. */
export function createHydeEvalEmbedder(): EmbeddingGenerator {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for the live HyDE retrieval eval');
  if (!Number.isInteger(HYDE_EVAL_EMBEDDING_DIMENSIONS) || HYDE_EVAL_EMBEDDING_DIMENSIONS < 1) {
    throw new Error(`EMBEDDING_DIMENSIONS must be a positive integer (got ${process.env.EMBEDDING_DIMENSIONS})`);
  }

  const client = new OpenAIEmbeddings({
    apiKey,
    model: HYDE_EVAL_EMBEDDING_MODEL,
    dimensions: HYDE_EVAL_EMBEDDING_DIMENSIONS,
    encodingFormat: 'float',
    configuration: {
      baseURL: HYDE_EVAL_EMBEDDING_BASE_URL,
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

interface GeneratedCall {
  input: HydeGenerateInput;
  output: HydeGeneratorOutput;
}

class RecordingGenerator implements HydeGeneratorLike {
  readonly calls: GeneratedCall[] = [];

  constructor(private readonly delegate: HydeGenerator) {}

  async generate(input: HydeGenerateInput): Promise<HydeGeneratorOutput> {
    const output = await this.delegate.generate(input);
    this.calls.push({ input, output });
    return output;
  }
}

interface ValidationCall {
  input: HydeValidationInput;
  output?: HydeValidationOutput;
  error?: string;
}

class RecordingValidator implements HydeValidatorLike {
  readonly calls: ValidationCall[] = [];

  constructor(private readonly delegate: HydeValidator) {}

  async validate(input: HydeValidationInput): Promise<HydeValidationOutput> {
    const call: ValidationCall = { input };
    this.calls.push(call);
    try {
      call.output = await this.delegate.validate(input);
      return call.output;
    } catch (error) {
      call.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }
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

/** Execute one real graph run with no database, pgvector, or opportunity evaluator. */
export async function runHydeCase(
  c: HydeEvalCase,
  mode: HydeGenerationMode,
  run: number,
  embedder: EmbeddingGenerator,
  candidates: EmbeddedCandidate[],
  rankingOptions: HydeRankingOptions = {},
): Promise<HydeEvalRunResult> {
  const generator = new RecordingGenerator(new HydeGenerator());
  const validator = mode === 'frame-v1' ? new RecordingValidator(new HydeValidator()) : undefined;
  const graph = new HydeGraphFactory(
    memoryDatabase(),
    embedder,
    new EmptyCache(),
    new LensInferrer(),
    generator,
    { mode, ...(validator ? { validator } : {}) },
  ).createGraph();

  const result = await graph.invoke({
    sourceType: 'query',
    sourceText: c.sourceText,
    profileContext: c.profileContext,
    maxLenses: 3,
    forceRegenerate: true,
  });
  const returned = result.hydeDocuments as Record<string, HydeDocumentState>;
  const queryEmbeddings = Object.entries(returned)
    .filter(([, document]) => document.hydeEmbedding.length > 0)
    .map(([lensId, document]): LensQueryEmbedding => ({
      lensId,
      corpus: document.targetCorpus,
      embedding: document.hydeEmbedding,
    }));
  const ranking = rankCandidates(queryEmbeddings, candidates, rankingOptions);
  const validationCall = validator?.calls[0];
  const diagnostics = analyzeGeneratedDocuments(
    mode,
    generator.calls.map((generated) => ({
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
    expectedTargetRank: expectedTargetRank(ranking, c.expectedTargetId),
    ranking,
    lensCount: result.lenses.length,
    returnedDocumentCount: Object.keys(returned).length,
    generatedDocumentCount: generator.calls.length,
    overwrittenDocumentCount: diagnostics.overwrittenDocumentCount,
    validatorSubmittedDocumentCount: diagnostics.validatorSubmittedDocumentCount,
    rejectedCount: mode === 'frame-v1' ? diagnostics.rejectedCount : null,
    failedOpenCount: diagnostics.failedOpenCount,
    documents: diagnostics.documents,
  };
}
