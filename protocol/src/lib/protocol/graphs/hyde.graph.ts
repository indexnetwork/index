/**
 * HyDE Graph: cache-aware hypothetical document generation with lens inference.
 *
 * Flow: infer_lenses → check_cache → (generate_missing if needed) → embed → cache_results.
 * Constructor injects Database, Embedder, Cache, LensInferrer, HydeGenerator.
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { createHash } from 'crypto';
import { HydeGraphState, type HydeDocumentState } from '../states/hyde.state';
import { LensInferrer } from '../agents/lens.inferrer';
import { HydeGenerator } from '../agents/hyde.generator';
import type { HydeGraphDatabase } from '../interfaces/database.interface';
import type { EmbeddingGenerator } from '../interfaces/embedder.interface';
import type { HydeCache } from '../interfaces/cache.interface';
import { HYDE_DEFAULT_CACHE_TTL } from '../agents/hyde.strategies';
import { protocolLogger } from '../support/protocol.logger';
import { timed } from '../../performance';

const logger = protocolLogger("HyDEGraphFactory");

/** Hash a lens label (+ optional corpus) to a short key for cache/DB indexing. */
function lensHash(label: string, corpus?: string): string {
  const input = corpus
    ? `${label.toLowerCase().trim()}:${corpus}`
    : label.toLowerCase().trim();
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

/** Build cache key for a specific lens. */
function cacheKey(
  sourceType: string,
  sourceId: string | undefined,
  sourceText: string,
  lens: string,
  corpus?: string,
): string {
  const entityKey =
    sourceId ?? `q:${createHash('sha256').update(sourceText).digest('hex').slice(0, 16)}`;
  return `hyde:${sourceType}:${entityKey}:${lensHash(lens, corpus)}`;
}

/**
 * Factory for the HyDE generation graph.
 * Injects Database, Embedder, Cache, LensInferrer, and HydeGenerator.
 */
export class HydeGraphFactory {
  constructor(
    private database: HydeGraphDatabase,
    private embedder: EmbeddingGenerator,
    private cache: HydeCache,
    private inferrer: LensInferrer,
    private generator: HydeGenerator,
  ) {}

  createGraph() {
    const self = this;

    /** Node 1: Infer lenses from source text + optional profile context. */
    const inferLensesNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.inferLenses", async () => {
        const { sourceText, profileContext, maxLenses } = state;

        logger.verbose('Inferring lenses', { sourceTextLength: sourceText.length, hasProfileContext: !!profileContext });

        const agentTimingsAccum: import('../../../types/chat-streaming.types').DebugMetaAgent[] = [];

        try {
          const inferrerStart = Date.now();
          const result = await self.inferrer.infer({
            sourceText,
            profileContext,
            maxLenses,
          });
          agentTimingsAccum.push({ name: 'lens.inferrer', durationMs: Date.now() - inferrerStart });

          logger.verbose('Lenses inferred', {
            count: result.lenses.length,
            lenses: result.lenses.map(l => ({ label: l.label, corpus: l.corpus })),
          });

          return { lenses: result.lenses, agentTimings: agentTimingsAccum };
        } catch (error) {
          logger.error('Lens inference failed in graph node', { error });
          return { lenses: [], agentTimings: agentTimingsAccum };
        }
      });
    };

    /** Node 2: Check cache/DB for existing HyDE docs matching inferred lenses. */
    const checkCacheNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.checkCache", async () => {
        const { sourceType, sourceId, sourceText, lenses, forceRegenerate } = state;

        if (forceRegenerate) {
          logger.verbose('Force regenerate - skipping cache');
          return { hydeDocuments: {} };
        }

        const cached: Record<string, HydeDocumentState> = {};

        for (const lens of lenses) {
          const key = cacheKey(sourceType, sourceId ?? undefined, sourceText, lens.label, lens.corpus);

          const fromCache = await self.cache.get<HydeDocumentState>(key);
          if (fromCache?.hydeText && fromCache.hydeEmbedding?.length) {
            logger.verbose('Cache hit', { lens: lens.label });
            cached[lens.label] = fromCache;
            continue;
          }

          // For entity sources, check DB for persisted docs
          if (sourceId) {
            const fromDb = await self.database.getHydeDocument(
              sourceType,
              sourceId,
              lensHash(lens.label, lens.corpus),
            );
            if (fromDb) {
              logger.verbose('DB hit', { lens: lens.label });
              cached[lens.label] = {
                lens: lens.label,
                targetCorpus: fromDb.targetCorpus as 'profiles' | 'intents',
                hydeText: fromDb.hydeText,
                hydeEmbedding: fromDb.hydeEmbedding,
              };
            }
          }
        }

        logger.verbose('Check cache done', {
          found: Object.keys(cached).length,
          requested: lenses.length,
        });
        return { hydeDocuments: cached };
      });
    };

    /** Conditional: decide whether to generate or skip to embed. */
    const shouldGenerate = (state: typeof HydeGraphState.State): string => {
      const { lenses, hydeDocuments } = state;
      const missing = lenses.filter((l) => !hydeDocuments[l.label]);
      if (missing.length > 0) {
        logger.verbose('Need to generate', { missing: missing.map(l => l.label) });
        return 'generate';
      }
      logger.verbose('All lenses cached, skipping generation');
      return 'skip';
    };

    /** Node 3: Generate HyDE documents for lenses not in cache. */
    const generateMissingNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.generateMissing", async () => {
        const { sourceText, lenses, hydeDocuments } = state;
        const missing = lenses.filter((l) => !hydeDocuments[l.label]);

        logger.verbose('Generating HyDE documents', {
          count: missing.length,
          lenses: missing.map(l => l.label),
        });

        const agentTimingsAccum: import('../../../types/chat-streaming.types').DebugMetaAgent[] = [];
        const generated: Record<string, HydeDocumentState> = {};

        await Promise.all(
          missing.map(async (lens) => {
            const generatorStart = Date.now();
            const out = await self.generator.generate({
              sourceText,
              lens: lens.label,
              corpus: lens.corpus,
            });
            agentTimingsAccum.push({ name: 'hyde.generator', durationMs: Date.now() - generatorStart });
            generated[lens.label] = {
              lens: lens.label,
              targetCorpus: lens.corpus,
              hydeText: out.text,
              hydeEmbedding: [],
            };
          })
        );

        return { hydeDocuments: { ...state.hydeDocuments, ...generated }, agentTimings: agentTimingsAccum };
      });
    };

    /** Node 4: Embed all HyDE documents that don't have embeddings yet. */
    const embedNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.embed", async () => {
        const { hydeDocuments } = state;
        const lensLabels = Object.keys(hydeDocuments);
        const toEmbed: { label: string; doc: HydeDocumentState }[] = [];
        const updated: Record<string, HydeDocumentState> = {};
        const hydeEmbeddings: Record<string, number[]> = {};

        for (const label of lensLabels) {
          const doc = hydeDocuments[label];
          if (!doc) continue;
          if (doc.hydeEmbedding?.length) {
            updated[label] = doc;
            hydeEmbeddings[label] = doc.hydeEmbedding;
          } else {
            toEmbed.push({ label, doc });
          }
        }

        if (toEmbed.length > 0) {
          logger.verbose('Embedding documents', { count: toEmbed.length });
          const texts = toEmbed.map((t) => t.doc.hydeText);
          const embeddings = await self.embedder.generate(texts);
          const embeddingArray = Array.isArray(embeddings[0])
            ? (embeddings as number[][])
            : [embeddings as number[]];

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

    /** Node 5: Cache results in Redis; persist to DB for entity sources. */
    const cacheResultsNode = async (state: typeof HydeGraphState.State) => {
      return timed("HydeGraph.cacheResults", async () => {
        const { sourceType, sourceId, sourceText, hydeDocuments } = state;

        for (const label of Object.keys(hydeDocuments)) {
          const doc = hydeDocuments[label];
          if (!doc) continue;

          const key = cacheKey(sourceType, sourceId ?? undefined, sourceText, label, doc.targetCorpus);
          await self.cache.set(key, doc, { ttl: HYDE_DEFAULT_CACHE_TTL });

          // Persist to DB for entity sources (intent/profile)
          if (sourceId) {
            await self.database.saveHydeDocument({
              sourceType,
              sourceId,
              strategy: lensHash(label, doc.targetCorpus),
              targetCorpus: doc.targetCorpus,
              hydeText: doc.hydeText,
              hydeEmbedding: doc.hydeEmbedding,
            });
          }
        }

        logger.verbose('Cached results', {
          count: Object.keys(hydeDocuments).length,
        });
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
      })
      .addEdge('generate_missing', 'embed')
      .addEdge('embed', 'cache_results')
      .addEdge('cache_results', END);

    return workflow.compile();
  }
}
