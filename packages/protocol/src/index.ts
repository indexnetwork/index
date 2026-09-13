// =============================================================================
// @indexnetwork/protocol — public API barrel
//
// This file is the ONLY supported entry point. Deep imports
// ("@indexnetwork/protocol/src/...") are not part of the contract and may break
// in any release. Every symbol is re-exported explicitly (no wildcards) so the
// surface is reviewable and changes are intentional.
//
// Breaking changes to any export require a major bump; see STABILITY.md.
// =============================================================================

// ─── Host runtime hooks ───────────────────────────────────────────────────────

export { setRequestContextStore } from "./internal/shared/observability/request-context.js";
export { setLoggerFactory } from "./internal/shared/observability/log.js";
export { setTimingWrapper } from "./internal/shared/observability/performance.js";

// ─── Host ports (implement these to wire up your infrastructure) ──────────────

export type { OpportunityCache } from "./platform/discovery/cache.js";
export type {
  IntentNetworkFinalAssignmentResult,
  Opportunity,
  OpportunityStatus,
  OpportunityControllerDatabase,
  OutcomeOutbox,
  RadarGraphDatabase,
} from "./platform/database.js";
export type { IntentFollowUp } from "./platform/runtime/follow-up.js";

// ─── Intents ──────────────────────────────────────────────────────────────────

export { Intents } from "./capabilities/intents.js";
export type {
  ClarifyAnswer,
  ClarifyInput,
  ClarifyQuestion,
  ClarifyResult,
  IntentSemanticMetadata,
  PreparedIntent,
} from "./capabilities/intents.js";
export type { NetworkAssignmentMetadata } from "./protocol/schemas/network-assignment.schema.js";

// ─── Networks ─────────────────────────────────────────────────────────────────

export { Networks } from "./capabilities/networks.js";
export { resolveDiscoveryNetworkScope, renderDiscoveryNetworkContext } from "./protocol/discovery.rules.js";

// ─── Negotiations ─────────────────────────────────────────────────────────────

export { Negotiations } from "./capabilities/negotiations.js";
export { decideNegotiationOpening, observeNegotiation, negotiationTurnSchema } from "./protocol/negotiation.rules.js";
export type { NegotiationState, NegotiationTurn } from "./protocol/negotiation.rules.js";
export {
  NEGOTIATION_GUIDANCE,
  CANONICAL_GUIDANCE_SUMMARY,
  CANONICAL_GUIDANCE_TOPICS,
  CANONICAL_GUIDANCE_TOPICS_CONTENT,
} from "./protocol/protocol.prompt.js";

// ─── Opportunities ────────────────────────────────────────────────────────────

export { pairKeyOf } from "./internal/opportunities/opportunity.counterparties.js";
export { canUserSeeOpportunity, isActionableForViewer } from "./internal/opportunities/opportunity.utils.js";
export { updateOpportunityStatus } from "./internal/opportunities/opportunity.graph.modes.js";
export { getPrimaryActionLabel } from "./internal/opportunities/opportunity.labels.js";
export { stripUnsupportedOpportunityClaims } from "./internal/shared/utils/claim-safety.js";
export { RadarGraphFactory } from "./internal/opportunities/radar/radar.graph.js";
export {
  OpportunityPresenter,
  buildApiChatCardPresentationCacheKey,
  buildRadarCardPresentationCacheKey,
  gatherPresenterContext,
  presentOpportunity,
  safeFallbackSummary,
  stripUuids,
  truncateAtBoundary,
} from "./internal/opportunities/opportunity.presentation.js";
export type { PresenterDatabase, UserInfo } from "./internal/opportunities/opportunity.presentation.js";
export { PoolDiscriminatorMiner } from "./internal/opportunities/discriminator/discriminator.miner.js";
export {
  isOutcomeQuestionsActivated,
  OUTCOME_MAX_CANDIDATES,
  OUTCOME_MAX_PUBLIC_CONTEXT_CHARS,
  OUTCOME_MIN_INDEPENDENT_EXAMPLES,
} from "./internal/opportunities/outcome/outcome.env.js";
export { runOutcomeShadow } from "./internal/opportunities/outcome/outcome.shadow.js";
export type { OutcomeExample, OutcomeLabel } from "./internal/opportunities/outcome/outcome.types.js";
