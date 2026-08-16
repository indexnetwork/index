/**
 * contexts/application — orchestrators, factories, and service classes.
 *
 * Re-exports the orchestration tier of the participant-context capability:
 * graph factories (LangGraph compilations), LLM service classes, and utility
 * helpers that belong to the application layer.  These are the building blocks
 * that foreground and ambient adapters compose to implement use cases.
 *
 * Boundary: application-layer only.  Imports from contexts/domain,
 * contexts/ports, and shared/ infrastructure — never from runtime/,
 * host implementations, or capability facades.
 *
 * ## Foreground use cases (onboarding / explicit enrichment)
 *
 * - {@link EnrichmentGraphFactory} — compiles the enrichment pipeline graph
 *   (scrape → decompose-premises → generate-profile → write-profile).
 *   Invoked by the foreground shell for `preview_profile`, `confirm_profile`,
 *   and `enrich_from_url` tools.
 * - {@link PremiseGraphFactory} — compiles the premise lifecycle graph
 *   (analyze → embed → dedupe → persist → index → assign-networks).
 *   Invoked by the foreground shell for premise CRUD tools.
 * - {@link UserContextGenerator} — synthesizes network-scoped context paragraphs
 *   and the global identity paragraph from the active premise set.
 *   Called by the background context-refresh adapter after premise mutations.
 *
 * ## Ambient use cases (scrape / decompose / regenerate / index)
 *
 * - {@link PremiseDecomposer} — decomposes free-text or scraped input into atomic
 *   premises.  Used inside EnrichmentGraphFactory (decompose-premises node) and
 *   standalone by the background decompose adapter.
 * - {@link PremiseAnalyzer} — Speech Act classification and felicity scoring.
 *   Used inside PremiseGraphFactory (analyze node).
 * - {@link PremiseIndexer} — scores premise relevance to a network index.
 *   Used inside PremiseGraphFactory (assign-networks node).
 * - {@link EnrichmentGenerator} — generates a structured profile from user account
 *   data via the enrichment generate-mode LLM pipeline.
 *
 * ## HyDE (Hypothetical Document Embeddings)
 *
 * HyDE is a protocol-owned technology binding that produces hypothetical
 * embedding documents for semantic retrieval.  The HyDE sub-capability is
 * participant-context-adjacent: it transforms participant context (premise text,
 * profile summary) into search-optimized representations.
 *
 * - {@link HydeGraphFactory} — compiles the full HyDE pipeline graph.
 * - {@link HydeGenerator} — generates hypothetical documents from a source text
 *   and a lens label.
 * - {@link LensInferrer} — infers retrieval lenses from a source text and optional
 *   profile context.
 * - {@link HydeValidator} — validates generated hypothetical documents against
 *   prompt-injection and out-of-scope risks.
 *
 * IND-545: canonical application home for participant-context orchestrators
 * previously spread across premises/, contexts/, enrichment/, and shared/hyde/.
 */

// ── Premise graph ─────────────────────────────────────────────────────────────
export { PremiseGraphFactory } from "../../premises/premise.graph.js";

// ── Premise service classes ───────────────────────────────────────────────────
export {
  PremiseDecomposer,
  type PremiseDecomposerOutput,
  type DecomposedPremise,
  type ExistingPremiseRef,
} from "../../premises/premise.decomposer.js";

export {
  PremiseAnalyzer,
  type PremiseAnalyzerOutput,
} from "../../premises/premise.analyzer.js";

export {
  PremiseIndexer,
  type PremiseIndexerOutput,
} from "../../premises/premise.indexer.js";

// ── Enrichment graph + service classes ───────────────────────────────────────
export {
  EnrichmentGraphFactory,
  type CompiledPremiseGraph,
} from "../../enrichment/enrichment.graph.js";

export { EnrichmentGenerator, type GeneratedProfile } from "../../enrichment/enrichment.generator.js";

export {
  shouldEnrichGhostDisplayNameFromParallel,
  isEnrichedNameMeaningful,
} from "../../enrichment/enrichment.enricher.js";

// ── Tool factories (foreground adapters) ──────────────────────────────────────
// These are foreground adapter entry points consumed by the tool composition root (shared/agent)
// composition.  They accept compiled graphs and host deps through the tool-dep
// ports and produce LangChain-compatible tool arrays.
export { createEnrichmentTools } from "../../enrichment/enrichment.tools.js";
export { createPremiseTools } from "../../premises/premise.tools.js";

// ── Context synthesis ─────────────────────────────────────────────────────────
export { UserContextGenerator } from "../../contexts/context.generator.js";

// ── HyDE graph + service classes ─────────────────────────────────────────────
export {
  HydeGraphFactory,
  type HydeLensInferrerLike,
  type HydeGeneratorLike,
  type HydeValidatorLike,
  type HydeGraphOptions,
} from "../../shared/hyde/hyde.graph.js";

export {
  HydeGenerator,
  type HydeGeneratorOutput,
  type HydeGenerateInput,
} from "../../shared/hyde/hyde.generator.js";

export {
  LensInferrer,
  type LensInferenceInput,
  type LensInferenceOutput,
  FRAME_SYSTEM_PROMPT,
  FrameResponseSchema,
} from "../../shared/hyde/lens.inferrer.js";

export {
  HydeValidator,
  type HydeValidationDocument,
  type HydeValidationInput,
  type HydeValidationVerdict,
  type HydeValidationOutput,
  HydeValidationResponseSchema,
  buildHydeValidationPrompt,
} from "../../shared/hyde/hyde.validator.js";

// ── HyDE utilities ────────────────────────────────────────────────────────────
export { computeHydeSourceTextHash, selectHydeDocumentsForGeneration } from "../../shared/hyde/hyde.documents.js";

export {
  getHydeGenerationMode,
  type HydeGenerationMode,
  HYDE_FRAME_GENERATION_VERSION,
} from "../../shared/hyde/hyde.env.js";

export {
  HYDE_DEFAULT_CACHE_TTL,
  HYDE_CORPUS_PROMPTS,
} from "../../shared/hyde/hyde.strategies.js";

export {
  type HydeSourceFrame,
  HydeSourceFrameSchema,
  type HydeFrameRole,
  type HydeFrameHardConstraint,
  type HydeFrameNamedEntity,
  type HydeFrameVocabulary,
  HYDE_HARD_CONSTRAINT_TYPES,
  HYDE_NAMED_ENTITY_TYPES,
} from "../../shared/hyde/hyde.frame.js";
