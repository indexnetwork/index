/**
 * participant-context/public — curated public surface of the participant-context capability.
 *
 * Re-exports the stable contracts from domain, application, and ports.
 * Runtime adapter creation (graph factories, tool factories) is accessible via
 * capabilities/participant-context.facade for package consumers and via
 * the tool composition root (shared/agent) for internal registries.
 *
 * Boundary: public-compatibility.  References only participant-context/domain,
 * participant-context/application, and participant-context/ports — never
 * the tool composition root (shared/agent) or host implementations.
 *
 * ## Intentionally excluded from public surface
 *
 * The following are application-internal and should be imported from
 * participant-context/application/ by code that genuinely needs them:
 * - `PremiseDecomposer`, `PremiseAnalyzer`, `PremiseIndexer` — used only inside
 *   PremiseGraphFactory and EnrichmentGraphFactory nodes.
 * - `EnrichmentGenerator` — used only inside EnrichmentGraphFactory.
 * - `HydeValidator`, `HydeSourceFrame`, `buildHydeValidationPrompt` — used only
 *   inside HydeGraphFactory nodes.
 * - `FRAME_SYSTEM_PROMPT`, `FrameResponseSchema` — LensInferrer internal prompts.
 *
 * ## Profile-domain compatibility note
 *
 * Several identifiers in the underlying database interface retain "profile" naming
 * (e.g. `getProfile`, `saveProfile`, `deleteProfile`, `UserIdentity`) — these are
 * deliberately frozen compatibility names.  The domain model's canonical term for
 * the synthesized global identity representation is the "global context paragraph"
 * (stored as a `user_contexts` row with `networkId = null`).
 *
 * IND-545: canonical public surface for participant-context, previously
 * fragmentary across capabilities/participant-context.facade, shared/hyde exports
 * in root index.ts, and direct premise/enrichment/context imports in tool.factory.
 */

// ── Domain contracts ──────────────────────────────────────────────────────────
export {
  PremiseGraphState,
  EnrichmentGraphState,
  HydeGraphState,
  type HydeDocumentState,
  type HydeDocumentOrigin,
  type HydeValidationStatus,
  // Context synthesis DTOs
  type UserContextInput,
  type IncrementalContextInput,
  type GlobalContextInput,
  type GlobalIncrementalContextInput,
  type UserContextResult,
  // Premise domain model
  type PremiseAssertion,
  type PremiseProvenance,
  type PremiseAnalysis,
  type PremiseValidity,
  type PremiseRecord,
} from "../domain/index.js";

// ── Application seams ─────────────────────────────────────────────────────────

// Graph factories (foreground + ambient adapter entry points)
export { PremiseGraphFactory } from "../application/index.js";
export {
  EnrichmentGraphFactory,
  type CompiledPremiseGraph,
} from "../application/index.js";
export {
  HydeGraphFactory,
  type HydeLensInferrerLike,
  type HydeGeneratorLike,
  type HydeValidatorLike,
  type HydeGraphOptions,
} from "../application/index.js";

// Context synthesis
export { UserContextGenerator } from "../application/index.js";

// HyDE generation utilities
export {
  HydeGenerator,
  type HydeGeneratorOutput,
  type HydeGenerateInput,
} from "../application/index.js";

// Lens inference
export {
  LensInferrer,
  type LensInferenceInput,
  type LensInferenceOutput,
} from "../application/index.js";

// HyDE environment + document utilities
export {
  getHydeGenerationMode,
  type HydeGenerationMode,
  HYDE_FRAME_GENERATION_VERSION,
  computeHydeSourceTextHash,
  selectHydeDocumentsForGeneration,
  HYDE_DEFAULT_CACHE_TTL,
  HYDE_CORPUS_PROMPTS,
} from "../application/index.js";

// Tool factories (foreground adapter composition entry points)
export { createEnrichmentTools } from "../application/index.js";
export { createPremiseTools } from "../application/index.js";

// Enrichment helper utilities
export {
  shouldEnrichGhostDisplayNameFromParallel,
  isEnrichedNameMeaningful,
} from "../application/index.js";

// ── Ports ─────────────────────────────────────────────────────────────────────
export type {
  PremiseGraphDatabase,
  EnrichmentGraphDatabase,
  HydeGraphDatabase,
  ProfileEnricher,
  EnrichmentResult,
  EnrichmentRequest,
  Scraper,
  ExtractUrlContentOptions,
  EmbeddingGenerator,
  Embedder,
} from "../ports/index.js";

// ── Tool dependency types ─────────────────────────────────────────────────────
// Re-exported from the capability port definitions for consumer convenience.
export type { EnrichmentToolDeps, PremiseToolDeps } from "../../capabilities/participant-context.tools.port.js";
