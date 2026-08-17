/**
 * contexts — the capability's sole cross-capability surface.
 *
 * Enrichment, premises, generated participant context, and HyDE representations
 * are one capability; only orchestration entry points and the read-model
 * generator cross its edge.
 */
export { createEnrichmentTools } from "../enrichment/enrichment.tools.js";
export { createPremiseTools } from "../premises/premise.tools.js";
export { EnrichmentGraphFactory } from "../enrichment/enrichment.graph.js";
export { PremiseGraphFactory } from "../premises/premise.graph.js";
export { UserContextGenerator } from "./context.generator.js";
export type { EnrichmentToolDeps, PremiseToolDeps } from "./context.tools.port.js";
