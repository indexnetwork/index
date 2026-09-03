/**
 * HyDE Graph state: cache-aware hypothetical document generation.
 * Used by the HyDE graph for infer_lenses → check_cache → generate_missing → embed → cache_results.
 */

import type { Id } from '../../platform/database.js';
import type { Lens, HydeTargetCorpus } from './lens.inferrer.js';
import type { HydeSourceFrame } from './hyde.frame.js';
import type { DebugMetaAgent } from "../../protocol/core.js";

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
export interface HydeState {
  /** Source type: intent, profile, user context, or ad-hoc query. */
  sourceType: 'intent' | 'query' | 'context';
  /** Source entity ID (e.g. intent ID, user ID). Omitted for ad-hoc query. */
  sourceId: Id<'intents'> | Id<'users'> | undefined;
  /** Source text to generate HyDE from (intent payload, profile summary, or query). */
  sourceText: string;
  /** Optional profile context for lens inference (user's profile summary). */
  profileContext: string | undefined;
  /** Maximum number of lenses to infer (default 3). */
  maxLenses: number;
  /** When true, skip cache/DB and regenerate all lenses. */
  forceRegenerate: boolean;
  /** Inferred lenses from the LensInferrer agent. */
  lenses: Lens[];
  /** Sanitized source-grounded frame produced by frame-v1 inference. */
  sourceFrame: HydeSourceFrame | undefined;
  /** Exact sourceText + sanitized sourceFrame identity for frame-v1 reuse. */
  frameFingerprint: string | undefined;
  /** Hash of the exact source text for persisted frame-v1 freshness checks. */
  sourceTextHash: string | undefined;
  /** Shared cohort marker assigned when this run generates any missing document. */
  generatedAt: string | undefined;
  /** Complete HyDE document snapshot keyed by lens label. Writers replace the snapshot so rejected documents can be removed before embedding. */
  hydeDocuments: Record<string, HydeDocumentState>;
  /** Final embeddings per lens (convenience output for search). Populated by embed node; used by opportunity graph. */
  hydeEmbeddings: Record<string, number[]>;
  /** Non-fatal error message. */
  error: string | undefined;
  /** Timing records for each agent invocation within this graph run. */
  agentTimings: DebugMetaAgent[];
}

/**
 * Everything that has a meaningful starting value. `sourceType` does not —
 * it was a bare Annotation with no default, i.e. a required input — so it
 * stays the caller's to supply rather than being given an invented one.
 */
export function hydeDefaults(): Omit<HydeState, "sourceType"> {
  return {
    sourceId: undefined,
    sourceText: "",
    profileContext: undefined,
    maxLenses: 3,
    forceRegenerate: false,
    lenses: [],
    sourceFrame: undefined,
    frameFingerprint: undefined,
    sourceTextHash: undefined,
    generatedAt: undefined,
    hydeDocuments: ({}),
    hydeEmbeddings: ({}),
    error: undefined,
    agentTimings: [],
  };
}

