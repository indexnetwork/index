/**
 * opportunities/application — LLM agents, LangGraph graphs, effectful orchestration.
 *
 * ## What lives here (flat files)
 * - Opportunity lifecycle transitions (opportunity.lifecycle.ts)
 * - Enricher: merge overlapping opportunities (opportunity.enricher.ts)
 * - Persistence coordinator (opportunity.persist.ts)
 * - Persistence admission gate (opportunity.persistence-admission.ts)
 * - Update admission gate (opportunity.update-admission.ts)
 * - Newborn-opportunity stamping (opportunity.newborn-stamping.ts)
 * - LLM evaluator (opportunity.evaluator.ts)
 * - LLM presenter agent (opportunity.presenter.ts)
 * - Introducer discovery (opportunity.introducer.ts)
 * - Existing-negotiation path (opportunity.existing-negotiation.ts)
 * - Opportunity LangGraph (opportunity.graph.ts)
 * - MCP discover flow (opportunity.discover.ts)
 * - Card presentation builder (opportunity.card-presentation.ts)
 * - Discovery continuation finalization (opportunity.discovery-continuation-finalization.ts)
 * - MCP lifecycle finalization (opportunity.discovery-mcp-lifecycle-finalization.ts)
 * - Negotiation summary helper (opportunity.discovery-negotiation-summary.ts)
 * - Negotiation context loader (negotiation-context.loader.ts)
 * - Feed selection (opportunity.feed-selection.ts)
 * - Delivery card cache (delivery-card.cache.ts)
 * - Pending questions merger (opportunity.pending-questions.ts)
 *
 * ## What lives in subdirectories (exported by path, not moved)
 * - discriminator/ — miner, assigner, shadow orchestrator
 * - negotiation-evidence/ — miner, shadow orchestrator
 * - outcome/ — shadow orchestrator
 * - radar/ — radar graph
 *
 * IND-551: canonical application layer for the opportunities capability.
 */

// ── Flat application files ────────────────────────────────────────────────────
export * from "./opportunity.lifecycle.js";
export * from "./opportunity.enricher.js";
export * from "./opportunity.persist.js";
export * from "./opportunity.persistence-admission.js";
export * from "./opportunity.update-admission.js";
export * from "./opportunity.newborn-stamping.js";
export * from "./opportunity.evaluator.js";
export * from "./opportunity.presenter.js";
export * from "./opportunity.introducer.js";
export * from "./opportunity.existing-negotiation.js";
export * from "./opportunity.graph.js";
export * from "./opportunity.card-presentation.js";
export * from "./opportunity.discovery-negotiation-summary.js";
export * from "./negotiation-context.loader.js";
export * from "./opportunity.feed-selection.js";
export * from "./delivery-card.cache.js";
export * from "./opportunity.pending-questions.js";
export * from "./opportunity.tools.js";

// ── Subdirectory application exports ─────────────────────────────────────────
// discriminator application
export { PoolDiscriminatorMiner } from "../discriminator/discriminator.miner.js";
export {
  PoolDiscriminatorAssigner,
} from "../discriminator/discriminator.assigner.js";
export type {
  PoolDiscriminatorAssignmentInput,
  PoolDiscriminatorAssignedAxis,
} from "../discriminator/discriminator.assigner.js";
export { runPoolDiscriminatorShadow } from "../discriminator/discriminator.shadow.js";

// negotiation-evidence application
export { NegotiationEvidenceMiner } from "../negotiation-evidence/negotiation-evidence.miner.js";
export { runNegotiationEvidenceShadow } from "../negotiation-evidence/negotiation-evidence.shadow.js";

// outcome application
export { runOutcomeShadow } from "../outcome/outcome.shadow.js";

// radar application
export { RadarGraphFactory } from "../radar/radar.graph.js";
