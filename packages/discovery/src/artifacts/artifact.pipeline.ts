import { createHash } from 'node:crypto';

import { getAbortSignalConfig, loggerFor, requestContext, timed } from '../core/runtime.js';
import type { AgentTiming, ArtifactCache, ArtifactStore, EmbeddingGenerator, Model, RunOptions } from '../core/types.js';
import type { ArtifactDeps, ArtifactInput, HydeDocumentState, HydeState, HydeValidationInput, HydeValidationVerdict } from './artifact.state.js';
import { sanitizeHydeSourceFrame, type HydeSourceFrame } from './frame.schema.js';
import { HydeGenerator } from './hyde.generator.js';
import { HydeValidator } from './hyde.validator.js';
import { LensInferrer } from './lens.inferrer.js';

/** Cache-aware source-grounded retrieval artifacts, independent of intent lifecycle. */
export class Artifacts {
  private readonly deps;

  constructor(deps: { database: ArtifactStore; embedder: EmbeddingGenerator; cache: ArtifactCache; model: Model }) {
    this.deps = { ...deps, inferrer: new LensInferrer(deps.model), generator: new HydeGenerator(deps.model), validator: new HydeValidator(deps.model) };
  }

  /**
   * @param input - Source identity, text, and optional inference context.
   * @param options - Cancellation and host observability for this invocation.
   * @returns Retrieval documents and vectors; only validated documents are persisted.
   * @throws On generation, embedding, storage failure, or cancellation.
   */
  prepare(input: ArtifactInput, options?: RunOptions) {
    return requestContext.run(options ?? requestContext.getStore() ?? {}, () => prepareArtifacts(input, this.deps));
  }
}

export const HYDE_FRAME_GENERATION_VERSION = 'frame-v1' as const;

/** Exact UTF-8 source identity, unchanged from persisted frame-v1 artifacts. */
export function computeHydeSourceTextHash(sourceText: string): string {
  return createHash('sha256').update(sourceText, 'utf8').digest('hex');
}

const HYDE_DEFAULT_CACHE_TTL = 3600;
const artifactLogger = loggerFor("Discovery:Artifacts");
let lastGenerationTimestamp = 0;

function nextGenerationMarker(): string {
  lastGenerationTimestamp = Math.max(Date.now(), lastGenerationTimestamp + 1);
  return new Date(lastGenerationTimestamp).toISOString();
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

/** Prepare validated retrieval artifacts, reusing only the matching source/frame cohort. */
export async function prepareArtifacts(input: ArtifactInput, deps: ArtifactDeps): Promise<HydeState> {
  const state: HydeState = {
    ...input, maxLenses: input.maxLenses ?? 3, forceRegenerate: input.forceRegenerate ?? false,
    lenses: [], hydeDocuments: {}, hydeEmbeddings: {}, agentTimings: [],
  };
  const apply = async (step: (state: HydeState, deps: ArtifactDeps) => Promise<Partial<HydeState>>) => {
    getAbortSignalConfig().signal?.throwIfAborted();
    const result = await step(state, deps);
    const timings = [...state.agentTimings, ...(result.agentTimings ?? [])];
    Object.assign(state, result, { agentTimings: timings });
    getAbortSignalConfig().signal?.throwIfAborted();
  };
  await apply(inferLensesNode);
  await apply(checkCacheNode);
  if (state.lenses.some(lens => !state.hydeDocuments[lens.label])) {
    await apply(generateMissingNode);
    await apply(validateGeneratedNode);
  }
  await apply(embedNode);
  await apply(cacheResultsNode);
  return state;
}

/** Node 1: Infer lenses from source text + optional profile context. */
export async function inferLensesNode(state: HydeState, deps: ArtifactDeps) {
  return timed("HydeGraph.inferLenses", async () => {
    const { sourceText, profileContext, maxLenses } = state;
    const agentTimingsAccum: AgentTiming[] = [];

    try {
      const traceEmitter = requestContext.getStore()?.traceEmitter;
      const inferrerStart = Date.now();
      traceEmitter?.({ type: "agent_start", name: "lens-inferrer" });
      const result = await deps.inferrer.infer({
        sourceText,
        profileContext,
        maxLenses,
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
      artifactLogger.error('Lens inference failed in graph node', { error });
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
export async function checkCacheNode(state: HydeState, deps: ArtifactDeps) {
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
export async function generateMissingNode(state: HydeState, deps: ArtifactDeps) {
  return timed("HydeGraph.generateMissing", async () => {
    const { sourceText, sourceFrame, lenses, hydeDocuments } = state;
    const missing = lenses.filter((lens) => !hydeDocuments[lens.label]);
    const agentTimingsAccum: AgentTiming[] = [];
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
        sourceFrame: sourceFrame ?? emptyFrame(),
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
export async function validateGeneratedNode(state: HydeState, deps: ArtifactDeps) {
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
    const agentTimingsAccum: AgentTiming[] = [];
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
      artifactLogger.error('HyDE validation failed open', { error });
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
export async function embedNode(state: HydeState, deps: ArtifactDeps) {
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
        const { label, doc } = toEmbed[i]!;
        const embedding = embeddingArray[i] ?? [];
        updated[label] = { ...doc, hydeEmbedding: embedding };
        hydeEmbeddings[label] = embedding;
      }
    }

    return { hydeDocuments: updated, hydeEmbeddings };
  });
}

/** Cache/persist only successfully validated frame-v1 docs. */
export async function cacheResultsNode(state: HydeState, deps: ArtifactDeps) {
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
