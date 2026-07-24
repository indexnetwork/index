/**
 * Participant-context capability's supported outward contract.
 *
 * Enrichment, premises, and generated participant context are one capability;
 * only orchestration entry points and the read-model generator cross its edge.
 */
export { EnrichmentGraphFactory } from "../enrichment/enrichment.graph.js";
export { PremiseGraphFactory } from "../premise/premise.graph.js";
export { UserContextGenerator } from "../context/context.generator.js";
export { createEnrichmentTools } from "../enrichment/enrichment.tools.js";
export { createPremiseTools } from "../premise/premise.tools.js";
export type { EnrichmentToolDeps, PremiseToolDeps } from "./participant-context.tools.port.js";
