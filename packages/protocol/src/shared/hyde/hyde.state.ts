/**
 * HyDE Graph state: cache-aware hypothetical document generation.
 * Used by the HyDE graph for infer_lenses → check_cache → generate_missing → embed → cache_results.
 */

import { Annotation } from '@langchain/langgraph';
import type { Id } from '../interfaces/database.interface.js';
import type { Lens, HydeTargetCorpus } from './lens.inferrer.js';
import type { HydeSourceFrame } from './hyde.frame.js';
import type { DebugMetaAgent } from '../../chat/chat-streaming.types.js';

export type HydeDocumentOrigin = 'cache' | 'db' | 'generated';
export type HydeValidationStatus = 'valid' | 'invalid' | 'failed_open';

/** Single HyDE document (text + embedding) for one lens. */
export interface HydeDocumentState {
  lens: string;
  targetCorpus: HydeTargetCorpus;
  hydeText: string;
  hydeEmbedding: number[];
  origin?: HydeDocumentOrigin;
  validationStatus?: HydeValidationStatus;
  hydeGenerationVersion?: 'frame-v1';
  frameFingerprint?: string;
  sourceTextHash?: string;
  generatedAt?: string;
}

/** State for the HyDE generation graph. */
export const HydeGraphState = Annotation.Root({
  // ─── Inputs ─────────────────────────────────────────────────────────────

  /** Source type: intent, profile, user context, or ad-hoc query. */
  sourceType: Annotation<'intent' | 'query' | 'context'>,

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

  /** Sanitized source-grounded frame produced by frame-v1 inference. */
  sourceFrame: Annotation<HydeSourceFrame | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Exact sourceText + sanitized sourceFrame identity for frame-v1 reuse. */
  frameFingerprint: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Hash of the exact source text for persisted frame-v1 freshness checks. */
  sourceTextHash: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Shared cohort marker assigned when this run generates any missing document. */
  generatedAt: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /**
   * Complete HyDE document snapshot keyed by lens label. Writers replace the
   * snapshot so rejected documents can be removed before embedding.
   */
  hydeDocuments: Annotation<Record<string, HydeDocumentState>>({
    reducer: (curr, next) => next ?? curr,
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
