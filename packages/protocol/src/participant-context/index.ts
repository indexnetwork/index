/**
 * participant-context — the capability's sole cross-capability surface.
 *
 * Enrichment, premises, generated participant context, and HyDE representations
 * are one capability; only orchestration entry points and the read-model
 * generator cross its edge.
 *
 * Anything outside this capability imports from here and nowhere else.
 * Supersedes the capabilities/participant-context.facade.ts + public/ pair; the
 * export list is the union of the facades it replaces, so the contract is unchanged.
 */
export {
  createEnrichmentTools,
  createPremiseTools,
  EnrichmentGraphFactory,
  PremiseGraphFactory,
  UserContextGenerator,
  // HyDE — participant-context technology binding
  HydeGraphFactory,
  HydeGenerator,
  LensInferrer,
} from "./application/index.js";
export type {
  EnrichmentToolDeps,
  PremiseToolDeps,
} from "./ports/participant-context.tools.port.js";
