/**
 * HyDE Graph state: cache-aware hypothetical document generation.
 * Used by the HyDE graph for infer_lenses → check_cache → generate_missing → embed → cache_results.
 */

import { Annotation } from '@langchain/langgraph';
import type { Id } from '../../../types/common.types';
import type { Lens, HydeTargetCorpus } from '../agents/lens.inferrer';
import type { DebugMetaAgent } from '../../../types/chat-streaming.types';

/** Single HyDE document (text + embedding) for one lens. */
export interface HydeDocumentState {
  lens: string;
  targetCorpus: HydeTargetCorpus;
  hydeText: string;
  hydeEmbedding: number[];
}

/** State for the HyDE generation graph. */
export const HydeGraphState = Annotation.Root({
  // ─── Inputs ─────────────────────────────────────────────────────────────

  /** Source type: intent, profile, or ad-hoc query. */
  sourceType: Annotation<'intent' | 'profile' | 'query'>,

  /** Source entity ID (e.g. intent ID, user ID). Omitted for ad-hoc query. */
  sourceId: Annotation<Id<'intents'> | Id<'users'> | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Source text to generate HyDE from (intent payload, profile summary, or query). */
  sourceText: Annotation<string>,

  /** Optional profile context for lens inference (user's profile summary). */
  profileContext: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Maximum number of lenses to infer (default 3). */
  maxLenses: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 3,
  }),

  /** When true, skip cache/DB and regenerate all lenses. */
  forceRegenerate: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  // ─── Intermediate / output ─────────────────────────────────────────────

  /** Inferred lenses from the LensInferrer agent. */
  lenses: Annotation<Lens[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /**
   * HyDE documents per lens (from cache, DB, or newly generated).
   * Keyed by lens label; values include hydeText and hydeEmbedding.
   */
  hydeDocuments: Annotation<Record<string, HydeDocumentState>>({
    reducer: (curr, next) => (next ? { ...curr, ...next } : curr),
    default: () => ({}),
  }),

  /**
   * Final embeddings per lens (convenience output for search).
   * Populated by embed node; used by opportunity graph.
   */
  hydeEmbeddings: Annotation<Record<string, number[]>>({
    reducer: (curr, next) => (next ? { ...curr, ...next } : curr),
    default: () => ({}),
  }),

  /** Non-fatal error message. */
  error: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Timing records for each agent invocation within this graph run. */
  agentTimings: Annotation<DebugMetaAgent[]>({
    reducer: (acc, val) => [...acc, ...val],
    default: () => [],
  }),
});
