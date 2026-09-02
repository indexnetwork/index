// =============================================================================
// @indexnetwork/protocol — public API barrel
//
// This file is the ONLY supported entry point. Deep imports
// ("@indexnetwork/protocol/src/...") are not part of the contract and may break
// in any release. Every symbol is re-exported explicitly (no wildcards) so the
// surface is reviewable and changes are intentional.
//
// Stability tiers are defined in STABILITY.md. In short:
//   • Stable       — Interfaces, Graph factories, Agents, the tool/runtime
//                    helpers, and shared schemas.
//   • Experimental — Sections marked @experimental below (advanced graph state
//                    types and internal helpers); may change in a minor release.
// =============================================================================

// ─── Public API (recommended for external consumers) ──────────────────────────

export { getModelName } from "./internal/shared/agent/model.config.js";
export type {
  ResolvedToolContext,
  ToolDeps,
  RawToolDefinition,
} from "./internal/shared/agent/tool.helpers.js";
export { resolveChatContext } from "./internal/shared/agent/tool.helpers.js";
export { ChatContextAccessError } from "./platform/runtime/errors.js";
export { deriveAllowedNetworkIds, deriveDiscoveryNetworkIds } from "./internal/shared/agent/tool.scope.js";
export type { ToolScopeType, ScopeMembership } from "./protocol/core.js";
export { requestContext, setRequestContextStore } from "./internal/shared/observability/request-context.js";
export { setLoggerFactory } from "./internal/shared/observability/log.js";
export { setTimingWrapper } from "./internal/shared/observability/performance.js";
export { getToolTimeoutPolicy, invokeToolRuntime, toolRuntimeErrorToResult } from "./internal/shared/agent/tool.runtime.js";

// ─── Interfaces (implement these to wire up your infrastructure) ───────────────

export type { McpAuthResolver } from "./platform/auth/ports.js";
export type { Cache, CacheOptions, HydeCache, OpportunityCache } from "./platform/discovery/cache.js";
export type { DiscoveryNegotiationDigest } from "./protocol/schemas/negotiation-digest.schema.js";
export type {
  ChatGraphCompositeDatabase,
  UserDatabase,
  SystemDatabase,
  OpportunityGraphDatabase,
  OpportunityControllerDatabase,
  OutcomeOutbox,
  RadarGraphDatabase,
  IntentGraphDatabase,
  HydeGraphDatabase,
  PremiseGraphDatabase,
  Opportunity,
  OpportunityActor,
  OpportunityStatus,
  AssignmentNetworkMembership,
  IntentNetworkFinalAssignmentResult,
  CreateOpportunityData,
  IntentLifecycleStatus,
  TransitionLifecycleResult,
  IntentProposalRecord,
  ReviseIntentProposalInput,
  ConfirmProposalResult,
} from "./platform/database.js";
export type { Embedder, VectorStoreOption, VectorSearchResult, HydeCandidate, HydeSearchOptions, LensEmbedding } from "./platform/discovery/embedder.js";
export type { IntentFollowUp } from "./platform/runtime/follow-up.js";
export type { Scraper } from "./platform/discovery/scraper.js";
export type { Logger, ProtocolError, ProtocolTraceEvent, RequestContext, RequestContextStore } from "./platform/runtime/observability.js";
export { SYSTEM_AGENT_IDS } from './internal/agents/agent.types.js';

// ─── Shared schemas ───────────────────────────────────────────────────────────

export { ChatContextDigestSchema, type ChatContextDigest } from "./protocol/schemas/chat-context.schema.js";
export {
  QuestionBlockSchema,
  QuestionBlockQuestionSchema,
  parseQuestionMessage,
  serializeQuestionMessage,
} from "./protocol/question-block.schema.js";
export type { ParsedQuestionMessage, QuestionBlock, QuestionBlockQuestion } from "./protocol/question-block.schema.js";
export {
  questionBlockFixture,
  questionMessageFixture,
  questionProseFixture,
} from "./protocol/question-block.fixture.js";
export {
  QuestionPurposeSchema,
  QuestionStrategySchema,
  UnderspecificationTypeSchema,
} from "./protocol/question.js";
export type {
  Question,
  QuestionPurpose,
  QuestionRecoverySnapshot,
  QuestionStrategy,
  QuestionVoidedReason,
  UnderspecificationType,
} from "./protocol/question.js";
export { McpApiKeyMetadataSchema } from "./platform/auth/mcp.js";
export type {
  McpAuthInput,
  McpResolvedIdentity,
} from "./platform/auth/mcp.js";
export type { DiscoveryNegotiation } from "./protocol/schemas/discovery-question.schema.js";
export type { NetworkAssignmentMetadata } from "./protocol/schemas/network-assignment.schema.js";
export type { IntentIndexingResult } from "./protocol/core.js";
export type { HydeTargetCorpus, Lens } from "./protocol/core.js";
export type { DebugMetaAgent } from "./protocol/core.js";
export { DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD, resolveAssignmentNetworkScope, buildNetworkAssignmentDecision } from "./internal/shared/assignment/network-assignment.policy.js";
export { NEGOTIATION_MAX_TURNS_AMBIENT } from "./protocol/core.js";

export { HydeGraphFactory } from "./internal/discovery/hyde.graph.js";
// ─── Networks ─────────────────────────────────────────────────────────────────
// The whole capability behind one class: the community lifecycle graph, the
// membership graph, signal assignment, and the agent-facing tools.

export { Networks } from "./capabilities/networks.js";
export type {
  IntentNetworkIndexer,
  NetworksDeps,
  NetworkToolDeps,
} from "./capabilities/networks.js";

// ─── Intents ──────────────────────────────────────────────────────────────────
// The whole capability behind one class: lifecycle graph, verification,
// network indexing, guided intake, and the agent-facing tools.

export { Intents } from "./capabilities/intents.js";
export type {
  FollowUpPlan,
  FollowUpPlanInput,
  IntakeAnswer,
  IntakePack,
  IntakePackInput,
  IntakePackQuestion,
  IntakePackQuestionOption,
  IntakeRound,
  IntentIndexerOutput,
  IntentsDeps,
  IntentToolDeps,
  SynthesisInput,
  SynthesisResult,
} from "./capabilities/intents.js";

export { PremiseGraphFactory } from "./internal/premises/premise.graph.js";

// ─── Agents ───────────────────────────────────────────────────────────────────

export { HydeGenerator } from "./internal/discovery/hyde.generator.js";
export { LensInferrer } from "./internal/discovery/lens.inferrer.js";

// ─── Tools ────────────────────────────────────────────────────────────────────

export { createToolRegistry } from "./internal/shared/agent/tool.registry.js";
// Capability-owned tool entry points. These are explicit, narrow contracts;
// capability implementation directories remain private to the package.
export { createEnrichmentTools } from "./internal/enrichment/enrichment.tools.js";
export type { EnrichmentToolDeps } from "./internal/contexts/context.tools.port.js";
export { normalizeTelegramHandle } from './internal/shared/utils/telegram-handle.js';

// ─── MCP ──────────────────────────────────────────────────────────────────────

export { createMcpServer, buildMcpOnboardingMessage, ONBOARDING_ALLOWED } from "./internal/mcp/mcp.server.js";
export type { ScopedDepsFactory } from "./internal/mcp/mcp.server.js";
export { CANONICAL_MCP_CAPABILITY_POLICY_OPTIONS } from "./internal/mcp/mcp.authorization-policy.js";
// `McpCapabilityPolicyOptions` types the fourth `createMcpServer` parameter and
// `McpAuthorizationDenialEvent` is the sole argument of the observer's
// `onCapabilityDenied`. Both are required to type a host's own composition, so
// they ship with the entry point rather than with the pruned policy internals.
export type {
  McpAuthorizationDenialEvent,
  McpAuthorizationObserver,
  McpCapabilityPolicyOptions,
} from "./internal/mcp/mcp.authorization-policy.js";

// ─── Negotiation thread reading ────────────────────────────────────────────
/**
 * The negotiation thread is read-only in this package: the turn schemas below
 * describe rows a previous release wrote, and the opportunity surfaces read
 * them for Radar and presentation. Nothing in the protocol authors a turn.
 */
export {
  NEGOTIATION_CONTINUE_VERBS,
  NEGOTIATION_PAUSE_REASONS,
  NegotiationTurnSchema,
  NegotiationContinueTurnSchema,
  NegotiationPauseTurnSchema,
  NegotiationAuthoredTurnSchema,
  NegotiationOpeningTurnSchema,
  NegotiationVerdictSchema,
  isPauseTurn,
} from "./internal/negotiations/negotiation.turn.js";
export type {
  NegotiationTurn,
  NegotiationContinueVerb,
  NegotiationPauseReason,
  NegotiationPauseTurn,
  NegotiationContinueTurn,
  NegotiationAuthoredTurn,
  NegotiationVerdict,
  NegotiationNeedsPrincipalPayload,
  NegotiationReadyForVerdictPayload,
} from "./internal/negotiations/negotiation.turn.js";
export type {
  NegotiationGraphDatabase,
  NegotiationTaskRow,
  NegotiationTaskMetadata,
  NegotiationSeatBinding,
  NegotiationTaskState,
  NegotiationMessageRow,
  NegotiationRoundLogDatabase,
  NegotiationRoundLogEventKind,
  NegotiationRoundLogEventRecord,
} from "./platform/database/negotiation.js";

// ─── Opportunity compatibility exports ─────────────────────────────────────
/**
 * opportunity — the capability's sole cross-capability surface.
 *
 * Anything outside this capability imports from here and nowhere else.
 * Supersedes the capabilities/*.facade.ts + opportunities/public/ pair; the export
 * list is the union of the facades it replaces, so the contract is unchanged.
 */
export {
  getOrCreateDeliveryCardBatch,
} from "./internal/opportunities/delivery-card.cache.js";
export {
  OpportunityGraphFactory,
} from "./internal/opportunities/opportunity.graph.js";
export type {
  OpportunityGraphThresholdOverrides,
} from "./internal/opportunities/opportunity.graph.js";
export {
  pairKeyOf,
} from "./internal/opportunities/opportunity.candidates.js";
export type { OpportunityEvidence } from "./protocol/schemas/network-assignment.schema.js";
export type {
  CreateAndOpenResult,
  CreateDiscoveryMatchCandidateData,
  DiscoveryMatchCandidate,
  DiscoveryMatchCandidateStatus,
} from "./internal/opportunities/opportunity.candidates.js";
export {
  opportunityOwnerActionForStatus,
} from "./internal/opportunities/opportunity.owner-approval.js";
export type {
  OpportunityOwnerAction,
  OpportunityOwnerApprovalAttestation,
  OpportunityOwnerApprovalAuthority,
  OpportunityOwnerApprovalBinding,
  OpportunityOwnerApprovalChallenge,
  OpportunityOwnerApprovalDenialReason,
  OpportunityOwnerApprovalVerdict,
  OpportunityOwnerInteractionProvenance,
  OpportunityOwnerInteractionSurface,
} from "./internal/opportunities/opportunity.owner-approval.js";
export {
  bindOwnerApprovalProvenance,
} from "./internal/opportunities/opportunity.owner-provenance.js";
export {
  gatherPresenterContext,
  OpportunityPresenter,
} from "./internal/opportunities/opportunity.presentation.js";
export type {
  PresenterDatabase,
} from "./internal/opportunities/opportunity.presentation.js";
export {
  createOpportunityTools,
} from "./internal/opportunities/opportunity.tools.js";
export {
  createOpportunityVerdictTools,
} from "./internal/opportunities/opportunity.verdict.tools.js";
export {
  DISCOVERY_MIN_SIMILARITY,
  validateDiscoveryMinSimilarity,
} from "./internal/opportunities/discovery.env.js";
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
  buildCandidateEvidence,
} from "./internal/opportunities/opportunity.evidence.js";
export {
  getPrimaryActionLabel,
} from "./internal/opportunities/opportunity.labels.js";
export {
  buildApiChatCardPresentationCacheKey,
  buildDeliveryCardPresentationCacheKey,
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
  NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES,
  NEGOTIATION_EVIDENCE_QUESTIONS_MODE,
} from "./internal/opportunities/negotiation-evidence/negotiation-evidence.env.js";
export {
  NegotiationEvidenceMiner,
} from "./internal/opportunities/negotiation-evidence/negotiation-evidence.miner.js";
export {
  runNegotiationEvidenceShadow,
} from "./internal/opportunities/negotiation-evidence/negotiation-evidence.shadow.js";
export type {
  RawEvidenceOutcome,
  RawEvidenceOwnerAnswer,
  RawEvidenceSegment,
  RawEvidenceTurn,
} from "./internal/opportunities/negotiation-evidence/negotiation-evidence.types.js";
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
export type {
  OpportunityToolDeps,
} from "./internal/opportunities/opportunity.tools.port.js";
export {
  RadarGraphFactory,
} from "./internal/opportunities/radar/radar.graph.js";
