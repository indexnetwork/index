/**
 * HyDE Graph: cache-aware hypothetical document generation with lens inference.
 *
 * Flow: infer_lenses → check_cache → generate_missing? → validate_generated →
 * embed → cache_results.
 */
import { END, START, StateGraph } from '@langchain/langgraph';

import type { DebugMetaAgent } from "../../protocol/core.js";
import { getAbortSignalConfig } from '../shared/agent/model-signal.js';
import type { HydeCache } from '../../platform/discovery/cache.js';
import type { HydeGraphDatabase } from '../../platform/database.js';
import type { EmbeddingGenerator } from '../../platform/discovery/embedder.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';
import { timed } from '../shared/observability/performance.js';
import { requestContext } from "../shared/observability/request-context.js";
import { computeHydeSourceTextHash, HYDE_FRAME_GENERATION_VERSION } from '../shared/hyde-documents.js';
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
  validator?: HydeValidatorLike;
}

/** Hash a lens label (+ optional corpus) to a short key for cache/DB indexing. */
function lensHash(label: string, corpus?: string): string {
  const input = corpus
    ? `${label.toLowerCase().trim()}:${corpus}`
    : label.toLowerCase().trim();
  return computeHydeSourceTextHash(input).slice(0, 16);
}

function entityCacheKey(sourceId: string | undefined, sourceText: string): string {
  return sourceId ?? `q:${computeHydeSourceTextHash(sourceText).slice(0, 16)}`;
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
  return computeHydeSourceTextHash(`${sourceText}\0${JSON.stringify(sortedFrame(sourceFrame))}`);
}

function requireFrameFingerprint(frameFingerprint: string | undefined): string {
  if (!frameFingerprint) throw new Error('frame-v1 HyDE requires a frame fingerprint');
  return frameFingerprint;
}

/** Namespaced frame-v1 cache key. */
function cacheKey(
  sourceType: string,
  sourceId: string | undefined,
  sourceText: string,
  lens: string,
  corpus: string | undefined,
  frameFingerprint: string,
): string {
  const entityKey = entityCacheKey(sourceId, sourceText);
  return `hyde:${HYDE_FRAME_GENERATION_VERSION}:${sourceType}:${entityKey}:${frameFingerprint}:${lensHash(lens, corpus)}`;
}

/** Stable frame-v1 identity per lens/corpus. */
function dbStrategy(label: string, corpus?: string): string {
  return `${HYDE_FRAME_GENERATION_VERSION}:${lensHash(label, corpus)}`;
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
  return `d-${computeHydeSourceTextHash(`${doc.lens}\0${doc.targetCorpus}\0${doc.hydeText}`).slice(0, 16)}`;
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

/** The graph's channel state, as every node sees it. */
export type HydeState = typeof HydeGraphState.State;

/** Everything the HyDE nodes reach for. */
export interface HydeGraphDeps {
  database: HydeGraphDatabase;
  embedder: EmbeddingGenerator;
  cache: HydeCache;
  inferrer: HydeLensInferrerLike;
  generator: HydeGeneratorLike;
  options: HydeGraphOptions;
  validator: HydeValidatorLike;
}

/** Factory for the HyDE generation graph. Existing five-argument calls remain valid. */
export class HydeGraphFactory {
  /** Resolved dependency bag shared by every node. */
  public readonly deps: HydeGraphDeps;

  constructor(
    database: HydeGraphDatabase,
    embedder: EmbeddingGenerator,
    cache: HydeCache,
    inferrer: HydeLensInferrerLike,
    generator: HydeGeneratorLike,
    options: HydeGraphOptions = {},
  ) {
    this.deps = {
      database, embedder, cache, inferrer, generator, options,
      validator: options.validator ?? new HydeValidator(),
    };
  }

  createGraph() {
    const deps = this.deps;

    const workflow = new StateGraph(HydeGraphState)
      .addNode('infer_lenses', (state: HydeState) => inferLensesNode(state, deps))
      .addNode('check_cache', (state: HydeState) => checkCacheNode(state, deps))
      .addNode('generate_missing', (state: HydeState) => generateMissingNode(state, deps))
      .addNode('validate_generated', (state: HydeState) => validateGeneratedNode(state, deps))
      .addNode('embed', (state: HydeState) => embedNode(state, deps))
      .addNode('cache_results', (state: HydeState) => cacheResultsNode(state, deps))
      .addEdge(START, 'infer_lenses')
      .addEdge('infer_lenses', 'check_cache')
      .addConditionalEdges('check_cache', shouldGenerate, {
        generate: 'generate_missing',
        skip: 'embed',
      })
      .addEdge('generate_missing', 'validate_generated')
      .addEdge('validate_generated', 'embed')
      .addEdge('embed', 'cache_results')
      .addEdge('cache_results', END);

    return workflow.compile();
  }
}

/** Node 1: Infer lenses from source text + optional profile context. */
export async function inferLensesNode(state: HydeState, deps: HydeGraphDeps) {
  return timed("HydeGraph.inferLenses", async () => {
    const { sourceText, profileContext, maxLenses } = state;
    const agentTimingsAccum: DebugMetaAgent[] = [];

    try {
      const traceEmitter = requestContext.getStore()?.traceEmitter;
      const inferrerStart = Date.now();
      traceEmitter?.({ type: "agent_start", name: "lens-inferrer" });
      const result = await deps.inferrer.infer({
        sourceText,
        profileContext,
        maxLenses,
        frameConstrained: true,
      });
      const durationMs = Date.now() - inferrerStart;
      agentTimingsAccum.push({ name: 'lens.inferrer', durationMs });
      traceEmitter?.({ type: "agent_end", name: "lens-inferrer", durationMs, summary: result.lenses.length > 0 ? `Inferred ${result.lenses.length} lens(es)` : "lens-inferrer completed" });

      const sourceFrame = sanitizeHydeSourceFrame(sourceText, result.sourceFrame ?? emptyFrame());
      return {
        lenses: result.lenses,
        sourceFrame,
        frameFingerprint: computeHydeFrameFingerprint(sourceText, sourceFrame),
        sourceTextHash: computeHydeSourceTextHash(sourceText),
        generatedAt: nextGenerationMarker(),
        agentTimings: agentTimingsAccum,
      };
    } catch (error) {
      logger.error('Lens inference failed in graph node', { error });
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
  });
}

/** Node 2: Check the frame-isolated cache/DB for matching documents. */
export async function checkCacheNode(state: HydeState, deps: HydeGraphDeps) {
  return timed("HydeGraph.checkCache", async () => {
    const { sourceType, sourceId, sourceText, lenses, forceRegenerate } = state;

    if (forceRegenerate) return { hydeDocuments: {} };

    const frameFingerprint = requireFrameFingerprint(state.frameFingerprint);
    const sourceTextHash = state.sourceTextHash ?? computeHydeSourceTextHash(sourceText);
    const cached: Record<string, HydeDocumentState> = {};
    for (const lens of lenses) {
      const key = cacheKey(
        sourceType,
        sourceId ?? undefined,
        sourceText,
        lens.label,
        lens.corpus,
        frameFingerprint,
      );
      const fromCache = await deps.cache.get<HydeDocumentState>(key);
      const cacheAccepted = fromCache?.hydeText
        && fromCache.hydeEmbedding?.length
        && isFrameCacheDocument(fromCache, lens.label, frameFingerprint, sourceTextHash);
      if (cacheAccepted && fromCache) {
        cached[lens.label] = {
          ...fromCache,
          origin: 'cache' as const,
        };
        continue;
      }

      if (sourceId) {
        const fromDb = await deps.database.getHydeDocument(
          sourceType,
          sourceId,
          dbStrategy(lens.label, lens.corpus),
        );
        const frameDbContext = fromDb ? fromDb.context : null;
        if (fromDb && isFrameDbContext(frameDbContext, lens.label, frameFingerprint, sourceTextHash)) {
          cached[lens.label] = {
            lens: lens.label,
            targetCorpus: fromDb.targetCorpus as HydeDocumentState['targetCorpus'],
            hydeText: fromDb.hydeText,
            hydeEmbedding: fromDb.hydeEmbedding,
            origin: 'db' as const,
            validationStatus: 'valid' as const,
            hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION,
            frameFingerprint,
            sourceTextHash,
            generatedAt: (frameDbContext as FrameDbContext).generatedAt,
          };
        }
      }
    }

    const newestTimestamp = Math.max(
      ...Object.values(cached).map((doc) => Date.parse(doc.generatedAt ?? '')),
    );
    if (Number.isFinite(newestTimestamp)) {
      return {
        hydeDocuments: Object.fromEntries(Object.entries(cached).filter(([, doc]) =>
          Date.parse(doc.generatedAt ?? '') === newestTimestamp)),
      };
    }

    return { hydeDocuments: cached };
  });
}

/** Node 3: Generate all missing documents and return a complete snapshot. */
export async function generateMissingNode(state: HydeState, deps: HydeGraphDeps) {
  return timed("HydeGraph.generateMissing", async () => {
    const { sourceText, sourceFrame, lenses, hydeDocuments } = state;
    const missing = lenses.filter((lens) => !hydeDocuments[lens.label]);
    const agentTimingsAccum: DebugMetaAgent[] = [];
    const generated: Record<string, HydeDocumentState> = {};
    const sourceTextHash = state.sourceTextHash ?? computeHydeSourceTextHash(sourceText);
    const generatedAt = state.generatedAt ?? nextGenerationMarker();
    const frameFingerprint = requireFrameFingerprint(state.frameFingerprint);

    await Promise.all(missing.map(async (lens) => {
      const traceEmitter = requestContext.getStore()?.traceEmitter;
      const generatorStart = Date.now();
      traceEmitter?.({ type: "agent_start", name: "hyde-generator" });
      const out = await deps.generator.generate({
        sourceText,
        lens: lens.label,
        corpus: lens.corpus,
        ...(sourceFrame ? { sourceFrame } : {}),
      });
      const durationMs = Date.now() - generatorStart;
      agentTimingsAccum.push({ name: 'hyde.generator', durationMs });
      traceEmitter?.({ type: "agent_end", name: "hyde-generator", durationMs, summary: `Generated: ${lens.label}` });
      generated[lens.label] = {
        lens: lens.label,
        targetCorpus: lens.corpus,
        hydeText: out.text,
        hydeEmbedding: [],
        origin: 'generated' as const,
        frameFingerprint,
        sourceTextHash,
        generatedAt,
      };
    }));

    const retained = Object.fromEntries(Object.entries(hydeDocuments).map(([label, doc]) => [
      label,
      {
        ...doc,
        frameFingerprint,
        sourceTextHash,
        generatedAt,
      },
    ]));

    return { hydeDocuments: { ...retained, ...generated }, agentTimings: agentTimingsAccum };
  });
}

/** Validate newly generated docs in one batch. */
export async function validateGeneratedNode(state: HydeState, deps: HydeGraphDeps) {
  return timed("HydeGraph.validateGenerated", async () => {
    const generated = Object.values(state.hydeDocuments).filter((doc) => doc.origin === 'generated');
    if (generated.length === 0 || !deps.validator) return { hydeDocuments: state.hydeDocuments };

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
      const output = await deps.validator.validate({
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
}

/** Embed all accepted/cached documents that do not have embeddings. */
export async function embedNode(state: HydeState, deps: HydeGraphDeps) {
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
      const embeddings = await deps.embedder.generate(
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
}

/** Cache/persist only successfully validated frame-v1 docs. */
export async function cacheResultsNode(state: HydeState, deps: HydeGraphDeps) {
  return timed("HydeGraph.cacheResults", async () => {
    const { sourceType, sourceId, sourceText, hydeDocuments } = state;
    const frameFingerprint = requireFrameFingerprint(state.frameFingerprint);
    const sourceTextHash = state.sourceTextHash ?? computeHydeSourceTextHash(sourceText);
    await Promise.all(Object.entries(hydeDocuments).map(async ([label, doc]) => {
      if (!isFrameCacheDocument(doc, label, frameFingerprint, sourceTextHash)) return;

      const key = cacheKey(
        sourceType,
        sourceId ?? undefined,
        sourceText,
        label,
        doc.targetCorpus,
        frameFingerprint,
      );
      await deps.cache.set(key, doc, { ttl: HYDE_DEFAULT_CACHE_TTL });

      if (sourceId) {
        await deps.database.saveHydeDocument({
          sourceType,
          sourceId,
          strategy: dbStrategy(label, doc.targetCorpus),
          targetCorpus: doc.targetCorpus,
          hydeText: doc.hydeText,
          hydeEmbedding: doc.hydeEmbedding,
          context: {
            hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION,
            lensLabel: label,
            validationStatus: 'valid',
            frameFingerprint: doc.frameFingerprint,
            sourceTextHash: doc.sourceTextHash,
            generatedAt: doc.generatedAt,
          },
        });
      }
    }));
    return {};
  });
}

/** After the cache check: generate the missing documents, or skip straight to embedding. */
export function shouldGenerate(state: HydeState): string {
  return state.lenses.some((lens) => !state.hydeDocuments[lens.label]) ? 'generate' : 'skip';
}
