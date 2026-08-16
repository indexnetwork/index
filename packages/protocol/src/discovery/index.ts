/**
 * discovery — the capability's sole cross-capability surface.
 *
 * HyDE (Hypothetical Document Embeddings) is discovery machinery, not shared
 * infrastructure: it owns a graph, a generator, a lens inferrer, and a
 * validator. It lived under shared/ because two capabilities needed it, which
 * made shared/ the default home for anything with more than one consumer.
 *
 * Anything outside this capability imports from here and nowhere else.
 */
export {
  computeHydeSourceTextHash,
  selectHydeDocumentsForGeneration,
} from "./hyde.documents.js";
export {
  HYDE_FRAME_GENERATION_VERSION,
  getHydeGenerationMode,
} from "./hyde.env.js";
export type {
  HydeGenerationMode,
} from "./hyde.env.js";
export {
  HYDE_HARD_CONSTRAINT_TYPES,
  HYDE_NAMED_ENTITY_TYPES,
  HydeSourceFrameSchema,
} from "./hyde.frame.js";
export type {
  HydeFrameHardConstraint,
  HydeFrameNamedEntity,
  HydeFrameRole,
  HydeFrameVocabulary,
  HydeSourceFrame,
} from "./hyde.frame.js";
export {
  HydeGenerator,
} from "./hyde.generator.js";
export type {
  HydeGenerateInput,
  HydeGeneratorOutput,
} from "./hyde.generator.js";
export {
  HydeGraphFactory,
} from "./hyde.graph.js";
export type {
  HydeGeneratorLike,
  HydeGraphOptions,
  HydeLensInferrerLike,
  HydeValidatorLike,
} from "./hyde.graph.js";
export {
  HydeGraphState,
} from "./hyde.state.js";
export type {
  HydeDocumentOrigin,
  HydeDocumentState,
  HydeValidationStatus,
} from "./hyde.state.js";
export {
  HYDE_CORPUS_PROMPTS,
  HYDE_DEFAULT_CACHE_TTL,
} from "./hyde.strategies.js";
export {
  HydeValidationResponseSchema,
  HydeValidator,
  buildHydeValidationPrompt,
} from "./hyde.validator.js";
export type {
  HydeValidationDocument,
  HydeValidationInput,
  HydeValidationOutput,
  HydeValidationVerdict,
} from "./hyde.validator.js";
export {
  FRAME_SYSTEM_PROMPT,
  FrameResponseSchema,
  LensInferrer,
} from "./lens.inferrer.js";
export type {
  HydeTargetCorpus,
  Lens,
  LensInferenceInput,
  LensInferenceOutput,
} from "./lens.inferrer.js";
