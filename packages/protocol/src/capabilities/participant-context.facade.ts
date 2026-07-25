/**
 * Participant-context capability's supported outward contract.
 *
 * Enrichment, premises, generated participant context, and HyDE representations
 * are one capability; only orchestration entry points and the read-model
 * generator cross its edge.
 *
 * IND-545: this facade is now a thin compatibility shim over the canonical
 * participant-context domain-first module.  New consumers should prefer
 * importing from `participant-context/` directly.
 */
export {
  EnrichmentGraphFactory,
  PremiseGraphFactory,
  UserContextGenerator,
  createEnrichmentTools,
  createPremiseTools,
  // HyDE — participant-context technology binding
  HydeGraphFactory,
  HydeGenerator,
  LensInferrer,
} from "../participant-context/index.js";
export type { EnrichmentToolDeps, PremiseToolDeps } from "../participant-context/index.js";
