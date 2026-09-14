// =============================================================================
// @indexnetwork/protocol — public API barrel
//
// This file is the ONLY supported entry point. Deep imports
// ("@indexnetwork/protocol/src/...") are not part of the contract and may break
// in any release. Every symbol is re-exported explicitly (no wildcards) so the
// surface is reviewable and changes are intentional.
//
// Stability tiers are defined in STABILITY.md. In short:
//   • Stable       — Interfaces, Graph factories, Agents, and shared schemas.
//   • Experimental — Sections marked @experimental below (advanced graph state
//                    types and internal helpers); may change in a minor release.
// =============================================================================

// ─── Public API (recommended for external consumers) ──────────────────────────

export { getModelName } from "./internal/shared/agent/model.config.js";
export { ChatContextAccessError } from "./platform/runtime/errors.js";
export { deriveAllowedNetworkIds, deriveDiscoveryNetworkIds } from "./internal/shared/agent/scope.js";
export type { ScopeType, ScopeMembership } from "./protocol/core.js";
export { requestContext, setRequestContextStore } from "./internal/shared/observability/request-context.js";
export { setLoggerFactory } from "./internal/shared/observability/log.js";
export { setTimingWrapper } from "./internal/shared/observability/performance.js";

// ─── Interfaces (implement these to wire up your infrastructure) ───────────────

export type { Cache, CacheOptions, OpportunityCache } from "./platform/discovery/cache.js";
export type {
  CompositeDatabase,
  UserDatabase,
  SystemDatabase,
  OpportunityDatabase,
  OpportunityControllerDatabase,
  OutcomeOutbox,
  RadarGraphDatabase,
  IntentGraphDatabase,
  Opportunity,
  OpportunityActor,
  OpportunityStatus,
  AssignmentNetworkMembership,
  IntentNetworkFinalAssignmentResult,
  CreateOpportunityData,
  IntentLifecycleStatus,
  TransitionLifecycleResult,
  NegotiationContextDatabase,
  NegotiationContextRecord,
  NegotiationContextOutcome,
  NegotiationContextTurn,
} from "./platform/database.js";
export type { Embedder, VectorStoreOption, VectorSearchResult } from "./platform/discovery/embedder.js";
export type { IntentFollowUp } from "./platform/runtime/follow-up.js";
export type { Scraper } from "./platform/discovery/scraper.js";
export type { Logger, ProtocolError, ProtocolTraceEvent, RequestContext, RequestContextStore } from "./platform/runtime/observability.js";
export { SYSTEM_AGENT_IDS } from './internal/agents/agent.types.js';

// ─── Shared schemas ───────────────────────────────────────────────────────────

export { ChatContextDigestSchema, type ChatContextDigest } from "./protocol/schemas/chat-context.schema.js";
export { UnderspecificationTypeSchema } from "./protocol/schemas/underspecification.schema.js";
export type { UnderspecificationType } from "./protocol/schemas/underspecification.schema.js";
export type { DiscoveryNegotiation } from "./protocol/schemas/discovery-question.schema.js";
export type { NetworkAssignmentMetadata } from "./protocol/schemas/network-assignment.schema.js";
export type { DebugMetaAgent } from "./protocol/core.js";
export { Negotiations } from './capabilities/negotiations.js';
export { NEGOTIATION_MAX_TURNS, NEGOTIATION_MESSAGE_LIMIT } from './protocol/negotiation.constants.js';
export { NEGOTIATION_GUIDANCE } from './protocol/protocol.prompt.js';
export { CANONICAL_GUIDANCE_SUMMARY, CANONICAL_GUIDANCE_TOPICS, CANONICAL_GUIDANCE_TOPICS_CONTENT } from './protocol/protocol.prompt.js';
export type { CanonicalGuidanceTopic } from './protocol/protocol.prompt.js';
export { decideNegotiationOpening, decideNegotiationTurn, observeNegotiation, negotiationTurnSchema } from './protocol/negotiation.rules.js';
export type { NegotiationAction, NegotiationOutcome, NegotiationTurn, NegotiationState, NegotiationDecision, NegotiationRejection, NegotiationOpening, NegotiationOpeningDecision } from './protocol/negotiation.rules.js';
export type { NegotiationDatabase } from './platform/database/negotiation.js';

// ─── Networks ─────────────────────────────────────────────────────────────────
// The whole capability behind one class: the community lifecycle graph, the
// membership graph, and signal assignment.

export { Networks } from "./capabilities/networks.js";
export type { NetworksDeps } from "./capabilities/networks.js";

// ─── Intents ──────────────────────────────────────────────────────────────────
// The whole capability behind one class: lifecycle graph, verification, and
// payload clarification.

export { Intents } from "./capabilities/intents.js";
export type {
  ClarifyAnswer,
  ClarifyInput,
  ClarifyQuestion,
  ClarifyQuestionOption,
  ClarifyResult,
  IntentsDeps,
  IntentSemanticMetadata,
  PreparedIntent,
} from "./capabilities/intents.js";

// ─── Agents ───────────────────────────────────────────────────────────────────


export { normalizeTelegramHandle } from './internal/shared/utils/telegram-handle.js';


// ─── Opportunity compatibility exports ─────────────────────────────────────
/**
 * opportunity — the capability's sole cross-capability surface.
 *
 * Anything outside this capability imports from here and nowhere else.
 * Supersedes the capabilities/*.facade.ts + opportunities/public/ pair; the export
 * list is the union of the facades it replaces, so the contract is unchanged.
 */
export {
  pairKeyOf,
} from "./internal/opportunities/opportunity.counterparties.js";
export type { OpportunityEvidence } from "./protocol/schemas/network-assignment.schema.js";
export type {
  CreateIntentCounterpartyData,
  OpenedNegotiation,
} from "./internal/opportunities/opportunity.counterparties.js";
export {
  gatherPresenterContext,
  OpportunityPresenter,
} from "./internal/opportunities/opportunity.presentation.js";
export type {
  PresenterDatabase,
} from "./internal/opportunities/opportunity.presentation.js";
export {
  PoolDiscriminatorMiner,
} from "./internal/opportunities/discriminator/discriminator.miner.js";
export type {
  DiscriminatorMiningInput,
  MinedDiscriminator,
  PoolCandidate,
} from "./internal/opportunities/discriminator/discriminator.types.js";
export {
  hasUnsupportedOpportunityClaim,
  stripUnsupportedOpportunityClaims,
  stripUnsupportedOpportunityClaims as stripUnsupportedOpportunityClaimsText,
} from "./internal/shared/utils/claim-safety.js";
export {
  getPrimaryActionLabel,
} from "./internal/opportunities/opportunity.labels.js";
export {
  buildApiChatCardPresentationCacheKey,
  buildRadarCardPresentationCacheKey,
} from "./internal/opportunities/opportunity.presentation.js";
export {
  presentOpportunity,
  stripUuids,
  truncateAtBoundary,
} from "./internal/opportunities/opportunity.presentation.js";
export type {
  UserInfo,
} from "./internal/opportunities/opportunity.presentation.js";
export {
  DEFAULT_FALLBACK_HEADLINE,
  safeFallbackSummary,
} from "./internal/opportunities/opportunity.presentation.js";
export {
  canUserSeeOpportunity,
  classifyOpportunity,
  isActionableForViewer,
  RADAR_SOFT_TARGETS,
  selectByComposition,
  validateOpportunityActors,
} from "./internal/opportunities/opportunity.utils.js";
export {
  isOutcomeQuestionsActivated,
  OUTCOME_MAX_CANDIDATES,
  OUTCOME_MAX_PUBLIC_CONTEXT_CHARS,
  OUTCOME_MIN_INDEPENDENT_EXAMPLES,
} from "./internal/opportunities/outcome/outcome.env.js";
export {
  runOutcomeShadow,
} from "./internal/opportunities/outcome/outcome.shadow.js";
export type {
  OutcomeExample,
  OutcomeLabel,
  OutcomeShadowResult,
} from "./internal/opportunities/outcome/outcome.types.js";
export {
  RadarGraphFactory,
} from "./internal/opportunities/radar/radar.graph.js";

export { readOpportunities, updateOpportunityStatus, deleteOpportunity } from './internal/opportunities/opportunity.graph.modes.js';
export { resolveDiscoveryNetworkScope, renderDiscoveryNetworkContext } from './protocol/discovery.rules.js';
