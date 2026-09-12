import type { AgentTiming, ArtifactCache, ArtifactStore, EmbeddingGenerator, HydeTargetCorpus, Lens } from '../core/types.js';
import type { HydeSourceFrame } from './frame.schema.js';

export interface LensInferenceInput {
  /** Intent payload or search query. */
  sourceText: string;
  /** User's profile summary for domain context (optional). */
  profileContext?: string;
  /** Maximum number of lenses to infer (default 3). */
  maxLenses?: number;
}

export interface LensInferenceOutput {
  lenses: Lens[];
  /** Sanitized source frame, present only for frame-constrained inference. */
  sourceFrame?: HydeSourceFrame;
}

export interface HydeGeneratorOutput {
  text: string;
}

export interface HydeGenerateInput {
  /** Original intent or query text. */
  sourceText: string;
  /** Free-text lens label from LensInferrer (e.g. "crypto infra VC"). */
  lens: string;
  /** Which corpus voice to generate in. */
  corpus: HydeTargetCorpus;
  /** Sanitized source-grounded frame.  */
  sourceFrame: HydeSourceFrame;
}

export interface HydeValidationDocument {
  corpus: HydeTargetCorpus;
  text: string;
}

export interface HydeValidationInput {
  sourceText: string;
  sourceFrame: HydeSourceFrame;
  /** Generated documents keyed by opaque caller-supplied identifiers. */
  documents: Record<string, HydeValidationDocument>;
}

export interface HydeValidationVerdict {
  key: string;
  valid: boolean;
  unsupportedNamedEntities: string[];
  unsupportedHardConstraints: string[];
  reasoning: string;
}

export interface HydeValidationOutput {
  verdicts: HydeValidationVerdict[];
}

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


export interface ArtifactInput {
  sourceType: 'intent' | 'query' | 'context';
  sourceId?: string;
  sourceText: string;
  profileContext?: string;
  maxLenses?: number;
  forceRegenerate?: boolean;
}

export interface HydeState extends ArtifactInput {
  maxLenses: number;
  forceRegenerate: boolean;
  lenses: Lens[];
  sourceFrame?: HydeSourceFrame;
  frameFingerprint?: string;
  sourceTextHash?: string;
  generatedAt?: string;
  hydeDocuments: Record<string, HydeDocumentState>;
  hydeEmbeddings: Record<string, number[]>;
  agentTimings: AgentTiming[];
}

/** Narrow lens inferrer contract accepted by the artifact pipeline. */
export interface HydeLensInferrerLike {
  infer(input: LensInferenceInput): Promise<LensInferenceOutput>;
}

/** Narrow document generator contract accepted by the artifact pipeline. */
export interface HydeGeneratorLike {
  generate(input: HydeGenerateInput): Promise<HydeGeneratorOutput>;
}

/** Narrow batch validator contract accepted by the artifact pipeline. */
export interface HydeValidatorLike {
  validate(input: HydeValidationInput): Promise<HydeValidationOutput>;
}

export interface ArtifactDeps {
  database: ArtifactStore;
  embedder: EmbeddingGenerator;
  cache: ArtifactCache;
  inferrer: HydeLensInferrerLike;
  generator: HydeGeneratorLike;
  validator: HydeValidatorLike;
}
