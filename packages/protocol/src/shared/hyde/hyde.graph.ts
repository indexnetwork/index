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
import { computeHydeSourceTextHash } from './hyde.documents.js';
import { getHydeGenerationMode, HYDE_FRAME_GENERATION_VERSION, type HydeGenerationMode } from './hyde.env.js';
import { sanitizeHydeSourceFrame, type HydeSourceFrame } from './hyde.frame.js';
import type { HydeGenerateInput, HydeGeneratorOutput } from './hyde.generator.js';
import { HydeGraphState, type HydeDocumentState } from './hyde.state.js';
import type { LensInferenceInput, LensInferenceOutput } from './lens.inferrer.js';
import { HYDE_DEFAULT_CACHE_TTL } from './hyde.strategies.js';
import { HydeValidator, type HydeValidationInput, type HydeValidationOutput, type HydeValidationVerdict } from './hyde.validator.js';

const logger = protocolLogger("HyDEGraphFactory");
let lastGenerationTimestamp = 0;

function nextGenerationMarker(): string {
  lastGenerationTimestamp = Math.max(Date.now(), lastGenerationTimestamp + 1);
  return new Date(lastGenerationTimestamp).toISOString();
}

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

function sortedFrame(frame: HydeSourceFrame): HydeSourceFrame {
  const sort = <T>(items: T[]): T[] => [...items].sort((left, right) => {
    const leftJson = JSON.stringify(left);
    const rightJson = JSON.stringify(right);
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  });
  return {
    sourceRoles: sort(frame.sourceRoles),
    counterpartRoles: sort(frame.counterpartRoles),
    hardConstraints: sort(frame.hardConstraints),
    namedEntities: sort(frame.namedEntities),
    domainVocabulary: sort(frame.domainVocabulary),
  };
}

/** Deterministic identity for the source content and sanitized frame. */
function computeHydeFrameFingerprint(sourceText: string, sourceFrame: HydeSourceFrame): string {
  return createHash('sha256')
    .update(sourceText)
    .update('\0')
    .update(JSON.stringify(sortedFrame(sourceFrame)))
    .digest('hex');
}

function requireFrameFingerprint(frameFingerprint: string | undefined): string {
  if (!frameFingerprint) throw new Error('frame-v1 HyDE requires a frame fingerprint');
  return frameFingerprint;
}

/** Preserve the exact legacy Redis key and isolate frame-v1 data by namespace. */
function cacheKey(
  mode: HydeGenerationMode,
  sourceType: string,
  sourceId: string | undefined,
  sourceText: string,
  lens: string,
  corpus?: string,
  frameFingerprint?: string,
): string {
  const entityKey = entityCacheKey(sourceId, sourceText);
  if (mode === 'legacy') return `hyde:${sourceType}:${entityKey}:${lensHash(lens, corpus)}`;
  return `hyde:${HYDE_FRAME_GENERATION_VERSION}:${sourceType}:${entityKey}:${requireFrameFingerprint(frameFingerprint)}:${lensHash(lens, corpus)}`;
}

/** Preserve legacy identity and use a stable frame-v1 identity per lens/corpus. */
function dbStrategy(mode: HydeGenerationMode, label: string, corpus?: string): string {
  const hash = lensHash(label, corpus);
  return mode === 'legacy' ? hash : `${HYDE_FRAME_GENERATION_VERSION}:${hash}`;
}

function isValidGenerationMarker(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isFrameCacheDocument(
  doc: HydeDocumentState,
  lensLabel: string,
  frameFingerprint: string,
  sourceTextHash: string,
): boolean {
  return doc.hydeGenerationVersion === HYDE_FRAME_GENERATION_VERSION
    && doc.validationStatus === 'valid'
    && doc.lens === lensLabel
    && doc.frameFingerprint === frameFingerprint
    && doc.sourceTextHash === sourceTextHash
    && isValidGenerationMarker(doc.generatedAt);
}

interface FrameDbContext extends Record<string, unknown> {
  hydeGenerationVersion: typeof HYDE_FRAME_GENERATION_VERSION;
  lensLabel: string;
  validationStatus: 'valid';
  frameFingerprint: string;
  sourceTextHash: string;
  generatedAt: string;
}

function isFrameDbContext(
  context: Record<string, unknown> | null,
  lensLabel: string,
  frameFingerprint: string,
  sourceTextHash: string,
): context is FrameDbContext {
  return context?.hydeGenerationVersion === HYDE_FRAME_GENERATION_VERSION
    && context.lensLabel === lensLabel
    && context.validationStatus === 'valid'
    && context.frameFingerprint === frameFingerprint
    && context.sourceTextHash === sourceTextHash
    && isValidGenerationMarker(context.generatedAt);
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

          if (mode === HYDE_FRAME_GENERATION_VERSION) {
            const sourceFrame = sanitizeHydeSourceFrame(sourceText, result.sourceFrame ?? emptyFrame());
            return {
              lenses: result.lenses,
              sourceFrame,
              frameFingerprint: computeHydeFrameFingerprint(sourceText, sourceFrame),
              sourceTextHash: computeHydeSourceTextHash(sourceText),
              generatedAt: nextGenerationMarker(),
              agentTimings: agentTimingsAccum,
            };
          }

          return { lenses: result.lenses, agentTimings: agentTimingsAccum };
        } catch (error) {
          logger.error('Lens inference failed in graph node', { error });
          if (mode === HYDE_FRAME_GENERATION_VERSION) {
            const sourceFrame = emptyFrame();
            return {
              lenses: [],
              sourceFrame,
              frameFingerprint: computeHydeFrameFingerprint(sourceText, sourceFrame),
              sourceTextHash: computeHydeSourceTextHash(sourceText),
              generatedAt: nextGenerationMarker(),
              agentTimings: agentTimingsAccum,
            };
          }
          return { lenses: [], agentTimings: agentTimingsAccum };
        }
      });
    };

    /** Node 2: Check the mode-isolated cache/DB for matching documents. */
    const checkCacheNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.checkCache", async () => {
        const { sourceType, sourceId, sourceText, lenses, forceRegenerate } = state;

        if (forceRegenerate) return { hydeDocuments: {} };

        const frameFingerprint = mode === HYDE_FRAME_GENERATION_VERSION
          ? requireFrameFingerprint(state.frameFingerprint)
          : undefined;
        const sourceTextHash = mode === HYDE_FRAME_GENERATION_VERSION
          ? state.sourceTextHash ?? computeHydeSourceTextHash(sourceText)
          : undefined;
        const cached: Record<string, HydeDocumentState> = {};
        for (const lens of lenses) {
          const key = cacheKey(
            mode,
            sourceType,
            sourceId ?? undefined,
            sourceText,
            lens.label,
            lens.corpus,
            frameFingerprint,
          );
          const fromCache = await self.cache.get<HydeDocumentState>(key);
          const cacheAccepted = fromCache?.hydeText
            && fromCache.hydeEmbedding?.length
            && (mode === 'legacy' || isFrameCacheDocument(fromCache, lens.label, frameFingerprint!, sourceTextHash!));
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
            const frameDbContext = mode === HYDE_FRAME_GENERATION_VERSION && fromDb
              ? fromDb.context
              : null;
            if (fromDb && (mode === 'legacy' || isFrameDbContext(frameDbContext, lens.label, frameFingerprint!, sourceTextHash!))) {
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
                    frameFingerprint,
                    sourceTextHash,
                    generatedAt: (frameDbContext as FrameDbContext).generatedAt,
                  }
                  : {}),
              };
            }
          }
        }

        if (mode === HYDE_FRAME_GENERATION_VERSION) {
          const newestTimestamp = Math.max(
            ...Object.values(cached).map((doc) => Date.parse(doc.generatedAt ?? '')),
          );
          if (Number.isFinite(newestTimestamp)) {
            return {
              hydeDocuments: Object.fromEntries(Object.entries(cached).filter(([, doc]) =>
                Date.parse(doc.generatedAt ?? '') === newestTimestamp)),
            };
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
        const sourceTextHash = mode === HYDE_FRAME_GENERATION_VERSION
          ? state.sourceTextHash ?? computeHydeSourceTextHash(sourceText)
          : undefined;
        const generatedAt = mode === HYDE_FRAME_GENERATION_VERSION
          ? state.generatedAt ?? nextGenerationMarker()
          : undefined;

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
            ...(mode === HYDE_FRAME_GENERATION_VERSION
              ? {
                origin: 'generated' as const,
                frameFingerprint: requireFrameFingerprint(state.frameFingerprint),
                sourceTextHash,
                generatedAt,
              }
              : {}),
          };
        }));

        const retained = mode === HYDE_FRAME_GENERATION_VERSION
          ? Object.fromEntries(Object.entries(hydeDocuments).map(([label, doc]) => [
            label,
            {
              ...doc,
              frameFingerprint: requireFrameFingerprint(state.frameFingerprint),
              sourceTextHash,
              generatedAt,
            },
          ]))
          : hydeDocuments;

        return { hydeDocuments: { ...retained, ...generated }, agentTimings: agentTimingsAccum };
      });
    };

    /** Frame-v1 only: validate newly generated docs in one batch. */
    const validateGeneratedNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.validateGenerated", async () => {
        const generated = Object.values(state.hydeDocuments).filter((doc) => doc.origin === 'generated');
        if (generated.length === 0 || !validator) return { hydeDocuments: state.hydeDocuments };

        const frame = sanitizeHydeSourceFrame(state.sourceText, state.sourceFrame ?? emptyFrame());
        const documents: HydeValidationInput['documents'] = {};
        const lensByDocumentKey = new Map<string, string>();
        for (const doc of generated) {
          const key = opaqueDocumentKey(doc);
          documents[key] = { corpus: doc.targetCorpus, text: doc.hydeText };
          lensByDocumentKey.set(key, doc.lens);
        }

        const updated = { ...state.hydeDocuments };
        const agentTimingsAccum: DebugMetaAgent[] = [];
        const traceEmitter = requestContext.getStore()?.traceEmitter;
        const validatorStart = Date.now();
        let validCount = 0;
        let rejectedCount = 0;
        let failedOpenCount = 0;
        traceEmitter?.({ type: 'agent_start', name: 'hyde-validator' });

        try {
          const output = await validator.validate({
            sourceText: state.sourceText,
            sourceFrame: frame,
            documents,
          });
          const rawVerdicts: unknown[] = Array.isArray((output as { verdicts?: unknown }).verdicts)
            ? (output as { verdicts: unknown[] }).verdicts
            : [];

          for (const key of Object.keys(documents)) {
            const lensLabel = lensByDocumentKey.get(key);
            if (!lensLabel) continue;
            const matching = rawVerdicts.filter((value) =>
              !!value && typeof value === 'object' && (value as { key?: unknown }).key === key);
            const doc = updated[lensLabel];
            if (!doc) continue;

            if (matching.length !== 1 || !isRuntimeVerdict(matching[0])) {
              failedOpenCount += 1;
              updated[lensLabel] = { ...doc, validationStatus: 'failed_open', hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION };
              continue;
            }

            const verdict = matching[0];
            const hasUnsupportedGrounding = verdict.unsupportedNamedEntities.length > 0
              || verdict.unsupportedHardConstraints.length > 0;
            const contradictory = verdict.valid === hasUnsupportedGrounding;
            if (contradictory) {
              failedOpenCount += 1;
              updated[lensLabel] = { ...doc, validationStatus: 'failed_open', hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION };
            } else if (!verdict.valid) {
              rejectedCount += 1;
              delete updated[lensLabel];
            } else {
              validCount += 1;
              updated[lensLabel] = { ...doc, validationStatus: 'valid', hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION };
            }
          }
        } catch (error) {
          logger.error('HyDE validation failed open', { error });
          validCount = 0;
          rejectedCount = 0;
          failedOpenCount = generated.length;
          for (const doc of generated) {
            updated[doc.lens] = { ...doc, validationStatus: 'failed_open', hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION };
          }
        } finally {
          const durationMs = Date.now() - validatorStart;
          agentTimingsAccum.push({ name: 'hyde.validator', durationMs });
          traceEmitter?.({
            type: 'agent_end',
            name: 'hyde-validator',
            durationMs,
            summary: `${validCount} valid, ${rejectedCount} rejected, ${failedOpenCount} failed open`,
          });
        }

        return { hydeDocuments: updated, agentTimings: agentTimingsAccum };
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
        const frameFingerprint = mode === HYDE_FRAME_GENERATION_VERSION
          ? requireFrameFingerprint(state.frameFingerprint)
          : undefined;
        const sourceTextHash = mode === HYDE_FRAME_GENERATION_VERSION
          ? state.sourceTextHash ?? computeHydeSourceTextHash(sourceText)
          : undefined;
        for (const [label, doc] of Object.entries(hydeDocuments)) {
          if (mode === HYDE_FRAME_GENERATION_VERSION
            && !isFrameCacheDocument(doc, label, frameFingerprint!, sourceTextHash!)) continue;

          const key = cacheKey(
            mode,
            sourceType,
            sourceId ?? undefined,
            sourceText,
            label,
            doc.targetCorpus,
            frameFingerprint,
          );
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
                  frameFingerprint: doc.frameFingerprint,
                  sourceTextHash: doc.sourceTextHash,
                  generatedAt: doc.generatedAt,
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
