/**
 * HyDE Graph: cache-aware hypothetical document generation with lens inference.
 *
 * Legacy flow: infer_lenses → check_cache → generate_missing? → embed → cache_results.
 * Frame-v1 flow adds one batch validate_generated node before embed.
 */
import { createHash } from 'crypto';
import { END, START, StateGraph } from '@langchain/langgraph';

import type { DebugMetaAgent } from '../../chat/chat-streaming.types.js';
import { getAbortSignalConfig } from '../agent/model-signal.js';
import type { HydeCache } from '../interfaces/cache.interface.js';
import type { HydeGraphDatabase } from '../interfaces/database.interface.js';
import type { EmbeddingGenerator } from '../interfaces/embedder.interface.js';
import { protocolLogger } from '../observability/protocol.logger.js';
import { timed } from '../observability/performance.js';
import { requestContext } from "../observability/request-context.js";
import { getHydeGenerationMode, HYDE_FRAME_GENERATION_VERSION, type HydeGenerationMode } from './hyde.env.js';
import { sanitizeHydeSourceFrame, type HydeSourceFrame } from './hyde.frame.js';
import type { HydeGenerateInput, HydeGeneratorOutput } from './hyde.generator.js';
import { HydeGraphState, type HydeDocumentState } from './hyde.state.js';
import type { LensInferenceInput, LensInferenceOutput } from './lens.inferrer.js';
import { HYDE_DEFAULT_CACHE_TTL } from './hyde.strategies.js';
import { HydeValidator, type HydeValidationInput, type HydeValidationOutput, type HydeValidationVerdict } from './hyde.validator.js';

const logger = protocolLogger("HyDEGraphFactory");

/** Narrow lens inferrer contract accepted by the graph. */
export interface HydeLensInferrerLike {
  infer(input: LensInferenceInput): Promise<LensInferenceOutput>;
}

/** Narrow document generator contract accepted by the graph. */
export interface HydeGeneratorLike {
  generate(input: HydeGenerateInput): Promise<HydeGeneratorOutput>;
}

/** Narrow batch validator contract accepted by the graph. */
export interface HydeValidatorLike {
  validate(input: HydeValidationInput): Promise<HydeValidationOutput>;
}

export interface HydeGraphOptions {
  /** Test override. Production derives the mode from HYDE_FRAME_CONSTRAINTS_ENABLED. */
  mode?: HydeGenerationMode;
  validator?: HydeValidatorLike;
}

/** Hash a lens label (+ optional corpus) to a short key for cache/DB indexing. */
function lensHash(label: string, corpus?: string): string {
  const input = corpus
    ? `${label.toLowerCase().trim()}:${corpus}`
    : label.toLowerCase().trim();
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function entityCacheKey(sourceId: string | undefined, sourceText: string): string {
  return sourceId ?? `q:${createHash('sha256').update(sourceText).digest('hex').slice(0, 16)}`;
}

/** Preserve the exact legacy Redis key and isolate frame-v1 data by namespace. */
function cacheKey(
  mode: HydeGenerationMode,
  sourceType: string,
  sourceId: string | undefined,
  sourceText: string,
  lens: string,
  corpus?: string,
): string {
  const entityKey = entityCacheKey(sourceId, sourceText);
  return mode === 'legacy'
    ? `hyde:${sourceType}:${entityKey}:${lensHash(lens, corpus)}`
    : `hyde:${HYDE_FRAME_GENERATION_VERSION}:${sourceType}:${entityKey}:${lensHash(lens, corpus)}`;
}

/** Preserve the exact legacy DB strategy and isolate frame-v1 without migration. */
function dbStrategy(mode: HydeGenerationMode, label: string, corpus?: string): string {
  const hash = lensHash(label, corpus);
  return mode === 'legacy' ? hash : `${HYDE_FRAME_GENERATION_VERSION}:${hash}`;
}

function isFrameCacheDocument(doc: HydeDocumentState, lensLabel: string): boolean {
  return doc.hydeGenerationVersion === HYDE_FRAME_GENERATION_VERSION
    && doc.validationStatus === 'valid'
    && doc.lens === lensLabel;
}

function isFrameDbContext(context: Record<string, unknown> | null, lensLabel: string): boolean {
  return context?.hydeGenerationVersion === HYDE_FRAME_GENERATION_VERSION
    && context?.lensLabel === lensLabel
    && context?.validationStatus === 'valid';
}

function emptyFrame(): HydeSourceFrame {
  return {
    sourceRoles: [],
    counterpartRoles: [],
    hardConstraints: [],
    namedEntities: [],
    domainVocabulary: [],
  };
}

function opaqueDocumentKey(doc: HydeDocumentState): string {
  return `d-${createHash('sha256')
    .update(`${doc.lens}\0${doc.targetCorpus}\0${doc.hydeText}`)
    .digest('hex')
    .slice(0, 16)}`;
}

function isRuntimeVerdict(value: unknown): value is HydeValidationVerdict {
  if (!value || typeof value !== 'object') return false;
  const verdict = value as Partial<HydeValidationVerdict>;
  return typeof verdict.key === 'string'
    && typeof verdict.valid === 'boolean'
    && Array.isArray(verdict.unsupportedNamedEntities)
    && verdict.unsupportedNamedEntities.every((item) => typeof item === 'string')
    && Array.isArray(verdict.unsupportedHardConstraints)
    && verdict.unsupportedHardConstraints.every((item) => typeof item === 'string')
    && typeof verdict.reasoning === 'string';
}

/** Factory for the HyDE generation graph. Existing five-argument calls remain valid. */
export class HydeGraphFactory {
  constructor(
    private database: HydeGraphDatabase,
    private embedder: EmbeddingGenerator,
    private cache: HydeCache,
    private inferrer: HydeLensInferrerLike,
    private generator: HydeGeneratorLike,
    private options: HydeGraphOptions = {},
  ) {}

  createGraph() {
    const self = this;
    const mode = this.options.mode ?? getHydeGenerationMode();
    const validator = mode === HYDE_FRAME_GENERATION_VERSION
      ? (this.options.validator ?? new HydeValidator())
      : undefined;

    /** Node 1: Infer lenses from source text + optional profile context. */
    const inferLensesNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.inferLenses", async () => {
        const { sourceText, profileContext, maxLenses } = state;
        const agentTimingsAccum: DebugMetaAgent[] = [];

        try {
          const traceEmitter = requestContext.getStore()?.traceEmitter;
          const inferrerStart = Date.now();
          traceEmitter?.({ type: "agent_start", name: "lens-inferrer" });
          const result = await self.inferrer.infer({
            sourceText,
            profileContext,
            maxLenses,
            ...(mode === HYDE_FRAME_GENERATION_VERSION ? { frameConstrained: true } : {}),
          });
          const durationMs = Date.now() - inferrerStart;
          agentTimingsAccum.push({ name: 'lens.inferrer', durationMs });
          traceEmitter?.({ type: "agent_end", name: "lens-inferrer", durationMs, summary: result.lenses.length > 0 ? `Inferred ${result.lenses.length} lens(es)` : "lens-inferrer completed" });

          return {
            lenses: result.lenses,
            ...(mode === HYDE_FRAME_GENERATION_VERSION
              ? { sourceFrame: sanitizeHydeSourceFrame(sourceText, result.sourceFrame ?? emptyFrame()) }
              : {}),
            agentTimings: agentTimingsAccum,
          };
        } catch (error) {
          logger.error('Lens inference failed in graph node', { error });
          return { lenses: [], agentTimings: agentTimingsAccum };
        }
      });
    };

    /** Node 2: Check the mode-isolated cache/DB for matching documents. */
    const checkCacheNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.checkCache", async () => {
        const { sourceType, sourceId, sourceText, lenses, forceRegenerate } = state;

        if (forceRegenerate) return { hydeDocuments: {} };

        const cached: Record<string, HydeDocumentState> = {};
        for (const lens of lenses) {
          const key = cacheKey(mode, sourceType, sourceId ?? undefined, sourceText, lens.label, lens.corpus);
          const fromCache = await self.cache.get<HydeDocumentState>(key);
          const cacheAccepted = fromCache?.hydeText
            && fromCache.hydeEmbedding?.length
            && (mode === 'legacy' || isFrameCacheDocument(fromCache, lens.label));
          if (cacheAccepted && fromCache) {
            cached[lens.label] = {
              ...fromCache,
              ...(mode === HYDE_FRAME_GENERATION_VERSION ? { origin: 'cache' as const } : {}),
            };
            continue;
          }

          if (sourceId) {
            const fromDb = await self.database.getHydeDocument(
              sourceType,
              sourceId,
              dbStrategy(mode, lens.label, lens.corpus),
            );
            if (fromDb && (mode === 'legacy' || isFrameDbContext(fromDb.context, lens.label))) {
              cached[lens.label] = {
                lens: lens.label,
                targetCorpus: fromDb.targetCorpus as HydeDocumentState['targetCorpus'],
                hydeText: fromDb.hydeText,
                hydeEmbedding: fromDb.hydeEmbedding,
                ...(mode === HYDE_FRAME_GENERATION_VERSION
                  ? {
                    origin: 'db' as const,
                    validationStatus: 'valid' as const,
                    hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION,
                  }
                  : {}),
              };
            }
          }
        }

        return { hydeDocuments: cached };
      });
    };

    const shouldGenerate = (state: typeof HydeGraphState.State): string =>
      state.lenses.some((lens) => !state.hydeDocuments[lens.label]) ? 'generate' : 'skip';

    /** Node 3: Generate all missing documents and return a complete snapshot. */
    const generateMissingNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.generateMissing", async () => {
        const { sourceText, sourceFrame, lenses, hydeDocuments } = state;
        const missing = lenses.filter((lens) => !hydeDocuments[lens.label]);
        const agentTimingsAccum: DebugMetaAgent[] = [];
        const generated: Record<string, HydeDocumentState> = {};

        await Promise.all(missing.map(async (lens) => {
          const traceEmitter = requestContext.getStore()?.traceEmitter;
          const generatorStart = Date.now();
          traceEmitter?.({ type: "agent_start", name: "hyde-generator" });
          const out = await self.generator.generate({
            sourceText,
            lens: lens.label,
            corpus: lens.corpus,
            ...(mode === HYDE_FRAME_GENERATION_VERSION && sourceFrame ? { sourceFrame } : {}),
          });
          const durationMs = Date.now() - generatorStart;
          agentTimingsAccum.push({ name: 'hyde.generator', durationMs });
          traceEmitter?.({ type: "agent_end", name: "hyde-generator", durationMs, summary: `Generated: ${lens.label}` });
          generated[lens.label] = {
            lens: lens.label,
            targetCorpus: lens.corpus,
            hydeText: out.text,
            hydeEmbedding: [],
            ...(mode === HYDE_FRAME_GENERATION_VERSION ? { origin: 'generated' as const } : {}),
          };
        }));

        return { hydeDocuments: { ...hydeDocuments, ...generated }, agentTimings: agentTimingsAccum };
      });
    };

    /** Frame-v1 only: validate newly generated docs in one batch. */
    const validateGeneratedNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.validateGenerated", async () => {
        const generated = Object.values(state.hydeDocuments).filter((doc) => doc.origin === 'generated');
        if (generated.length === 0 || !validator) return { hydeDocuments: state.hydeDocuments };

        const frame = sanitizeHydeSourceFrame(state.sourceText, state.sourceFrame ?? emptyFrame());
        const keyed = Object.fromEntries(generated.map((doc) => [
          opaqueDocumentKey(doc),
          { lens: doc.lens, corpus: doc.targetCorpus, text: doc.hydeText },
        ]));
        const updated = { ...state.hydeDocuments };

        try {
          const output = await validator.validate({
            sourceText: state.sourceText,
            sourceFrame: frame,
            documents: keyed,
          });
          const rawVerdicts: unknown[] = Array.isArray((output as { verdicts?: unknown }).verdicts)
            ? (output as { verdicts: unknown[] }).verdicts
            : [];

          for (const [key, item] of Object.entries(keyed)) {
            const matching = rawVerdicts.filter((value) =>
              !!value && typeof value === 'object' && (value as { key?: unknown }).key === key);
            const doc = updated[item.lens];
            if (!doc) continue;

            if (matching.length !== 1 || !isRuntimeVerdict(matching[0])) {
              updated[item.lens] = { ...doc, validationStatus: 'failed_open', hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION };
              continue;
            }

            const verdict = matching[0];
            const contradictory = verdict.valid
              && (verdict.unsupportedNamedEntities.length > 0 || verdict.unsupportedHardConstraints.length > 0);
            if (contradictory) {
              updated[item.lens] = { ...doc, validationStatus: 'failed_open', hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION };
            } else if (!verdict.valid) {
              delete updated[item.lens];
            } else {
              updated[item.lens] = { ...doc, validationStatus: 'valid', hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION };
            }
          }
        } catch (error) {
          logger.error('HyDE validation failed open', { error });
          for (const doc of generated) {
            updated[doc.lens] = { ...doc, validationStatus: 'failed_open', hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION };
          }
        }

        return { hydeDocuments: updated };
      });
    };

    /** Embed all accepted/cached documents that do not have embeddings. */
    const embedNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.embed", async () => {
        const toEmbed: { label: string; doc: HydeDocumentState }[] = [];
        const updated: Record<string, HydeDocumentState> = {};
        const hydeEmbeddings: Record<string, number[]> = {};

        for (const [label, doc] of Object.entries(state.hydeDocuments)) {
          if (doc.hydeEmbedding?.length) {
            updated[label] = doc;
            hydeEmbeddings[label] = doc.hydeEmbedding;
          } else {
            toEmbed.push({ label, doc });
          }
        }

        if (toEmbed.length > 0) {
          const embeddings = await self.embedder.generate(
            toEmbed.map((item) => item.doc.hydeText),
            undefined,
            getAbortSignalConfig(),
          );
          const embeddingArray = Array.isArray(embeddings[0]) ? embeddings as number[][] : [embeddings as number[]];
          for (let i = 0; i < toEmbed.length; i++) {
            const { label, doc } = toEmbed[i];
            const embedding = embeddingArray[i] ?? [];
            updated[label] = { ...doc, hydeEmbedding: embedding };
            hydeEmbeddings[label] = embedding;
          }
        }

        return { hydeDocuments: updated, hydeEmbeddings };
      });
    };

    /** Cache/persist only legacy docs or successfully validated frame-v1 docs. */
    const cacheResultsNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.cacheResults", async () => {
        const { sourceType, sourceId, sourceText, hydeDocuments } = state;
        for (const [label, doc] of Object.entries(hydeDocuments)) {
          if (mode === HYDE_FRAME_GENERATION_VERSION && doc.validationStatus !== 'valid') continue;

          const key = cacheKey(mode, sourceType, sourceId ?? undefined, sourceText, label, doc.targetCorpus);
          await self.cache.set(key, doc, { ttl: HYDE_DEFAULT_CACHE_TTL });

          if (sourceId) {
            await self.database.saveHydeDocument({
              sourceType,
              sourceId,
              strategy: dbStrategy(mode, label, doc.targetCorpus),
              targetCorpus: doc.targetCorpus,
              hydeText: doc.hydeText,
              hydeEmbedding: doc.hydeEmbedding,
              ...(mode === HYDE_FRAME_GENERATION_VERSION ? {
                context: {
                  hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION,
                  lensLabel: label,
                  validationStatus: 'valid',
                },
              } : {}),
            });
          }
        }
        return {};
      });
    };

    const workflow = new StateGraph(HydeGraphState)
      .addNode('infer_lenses', inferLensesNode)
      .addNode('check_cache', checkCacheNode)
      .addNode('generate_missing', generateMissingNode)
      .addNode('embed', embedNode)
      .addNode('cache_results', cacheResultsNode)
      .addEdge(START, 'infer_lenses')
      .addEdge('infer_lenses', 'check_cache')
      .addConditionalEdges('check_cache', shouldGenerate, {
        generate: 'generate_missing',
        skip: 'embed',
      });

    if (mode === HYDE_FRAME_GENERATION_VERSION) {
      workflow
        .addNode('validate_generated', validateGeneratedNode)
        .addEdge('generate_missing', 'validate_generated')
        .addEdge('validate_generated', 'embed');
    } else {
      workflow.addEdge('generate_missing', 'embed');
    }

    workflow
      .addEdge('embed', 'cache_results')
      .addEdge('cache_results', END);

    return workflow.compile();
  }
}
