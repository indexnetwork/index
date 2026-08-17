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

export { getModelName } from "./shared/agent/model.config.js";
export type {
  ResolvedToolContext,
  ToolDeps,
  RawToolDefinition,
} from "./shared/agent/tool.helpers.js";
export { ChatContextAccessError, resolveChatContext } from "./shared/agent/tool.helpers.js";
export { deriveAllowedNetworkIds, deriveDiscoveryNetworkIds } from "./shared/agent/tool.scope.js";
export type { ToolScopeType } from "./shared/agent/tool.scope.js";
export { requestContext } from "./shared/observability/request-context.js";
export { setLoggerFactory } from "./shared/observability/log.js";
export { setTimingWrapper } from "./shared/observability/performance.js";
export { getToolTimeoutPolicy, invokeToolRuntime, toolRuntimeErrorToResult } from "./shared/agent/tool.runtime.js";

// ─── Interfaces (implement these to wire up your infrastructure) ───────────────

export type { McpAuthResolver } from "./shared/interfaces/auth.interface.js";
export type { Cache, CacheOptions, HydeCache, OpportunityCache } from "./shared/interfaces/cache.interface.js";
export type { ChatSummaryReader } from "./shared/interfaces/chat-summary.interface.js";
export type { QuestionerDatabase, PersistableQuestion, PersistedQuestion, QuestionFilters, ChatQuestionsHost } from "./questions/index.js";
export type { NegotiationSummaryReader } from "./shared/interfaces/negotiation-summary.interface.js";
export type { DiscoveryNegotiationDigest } from "./shared/schemas/negotiation-digest.schema.js";
export { NegotiationSummarizer } from "./negotiations/index.js";
export type { ContactServiceAdapter } from "./contacts/index.js";
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
  EnrichmentGraphDatabase,
  PremiseGraphDatabase,
  NegotiationGraphDatabase,
  NegotiationContinuationExecution,
  NegotiationContinuationReceipt,
  Opportunity,
  OpportunityActor,
  OpportunityStatus,
  AssignmentNetworkMembership,
  IntentNetworkFinalAssignmentResult,
  CreateOpportunityData,
} from "./shared/interfaces/database.interface.js";
export type { Embedder, VectorStoreOption, VectorSearchResult, HydeCandidate, HydeSearchOptions, LensEmbedding } from "./shared/interfaces/embedder.interface.js";
export type { IntentGraphQueue } from "./shared/interfaces/queue.interface.js";
export type { Scraper } from "./shared/interfaces/scraper.interface.js";
export type { EnrichmentRunInput, EnrichmentRunRecord } from "./shared/interfaces/enrichment-run.interface.js";
export type {
  NegotiationTimeoutQueue,
  AskUserExpiryPayload,
  NegotiationContinuationTimeoutIdentity,
} from "./shared/interfaces/negotiation-events.interface.js";
export type { AgentDispatcher, AgentDispatchResult, NegotiationTurnPayload } from "./shared/interfaces/agent-dispatcher.interface.js";
export { SYSTEM_AGENT_IDS } from './agents/index.js';

// ─── Shared schemas ───────────────────────────────────────────────────────────

export { ChatContextDigestSchema, type ChatContextDigest } from "./shared/schemas/chat-context.schema.js";
export {
  type Question,
  type UnderspecificationType,
  type QuestionStrategy,
  type QuestionGenerationResult,
  type QuestionPurpose,
  type NegotiationQuestionProvenance,
  NegotiationQuestionCandidateSchema,
  type QuestionPoolPush,
  type QuestionRecoverySnapshot,
  type QuestionVoidedReason,
  type QuestionPoolPushRequestStatus,
  type QuestionPoolPushRequestReason,
} from "./questions/index.js";
export type { PendingQuestionSummary } from "./shared/schemas/pending-question.schema.js";
export { McpApiKeyMetadataSchema } from "./shared/schemas/mcp-auth.schema.js";
export type {
  McpAuthInput,
  McpResolvedIdentity,
} from "./shared/schemas/mcp-auth.schema.js";
export type { DiscoveryNegotiation } from "./shared/schemas/discovery-question.schema.js";
export type { NetworkAssignmentMetadata } from "./shared/schemas/network-assignment.schema.js";
export { DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD, resolveAssignmentNetworkScope, buildNetworkAssignmentDecision } from "./shared/assignment/network-assignment.policy.js";

// ─── Graph factories ──────────────────────────────────────────────────────────

export { ChatGraphFactory } from "./agents/index.js";
export { type ChatPersonaConfig } from "./agents/index.js";
export { NEGOTIATOR_PERSONA_ID, createNegotiatorPersona } from "./agents/index.js";
export {
  SIGNAL_PERSONA_ID,
  SIGNAL_PERSONA,
} from "./agents/index.js";
export {
  REPORTER_PERSONA_ID,
  REPORTER_PERSONA,
  REPORTER_BRIEFING_KICKOFF,
} from "./agents/index.js";
export {
  ONBOARDING_PERSONA_ID,
  ONBOARDING_PERSONA,
} from "./agents/index.js";
export { RadarGraphFactory } from "./opportunities/index.js";
export { HydeGraphFactory } from "./discovery/index.js";
export { NetworkGraphFactory } from "./networks/index.js";
export { NetworkMembershipGraphFactory } from "./networks/index.js";
export { IntentGraphFactory } from "./intents/index.js";
export { SemanticVerifier } from "./intents/index.js";
export { IntentNetworkGraphFactory } from "./networks/index.js";
export { MaintenanceGraphFactory } from "./maintenance/maintenance.graph.js";
export type { MaintenanceGraphDatabase, MaintenanceGraphCache, MaintenanceGraphQueue } from "./maintenance/maintenance.graph.js";
export { NegotiationGraphFactory, negotiateCandidates } from "./negotiations/index.js";
export { OpportunityGraphFactory } from "./opportunities/index.js";
export { hasUnsupportedOpportunityClaim } from "./opportunities/index.js";
export type { StampNewbornOpportunitiesFn } from "./opportunities/index.js";
export { bindOwnerApprovalProvenance } from "./opportunities/index.js";
// The member/parameter types below are reachable from the exported entry points
// above: `OpportunityOwnerAction` types `OpportunityOwnerApprovalBinding.action`,
// `OpportunityOwnerApprovalDenialReason` types the denied `…Verdict.reason`, and
// the provenance pair types both `…Attestation.provenance` and the second
// argument of `bindOwnerApprovalProvenance`. An exported symbol whose members
// cannot be named is not usable, so these stay exported with it.
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
} from "./opportunities/index.js";
export { EnrichmentGraphFactory } from "./contexts/index.js";
export { PremiseGraphFactory } from "./contexts/index.js";

// ─── Agents ───────────────────────────────────────────────────────────────────

export { UserContextGenerator } from "./contexts/index.js";
export { ChatTitleGenerator } from "./agents/index.js";
export { ChatInterruptClassifier } from "./agents/index.js";
export { ChatSummarizer } from "./agents/index.js";
export { HydeGenerator } from "./discovery/index.js";
export { SuggestionGenerator } from "./agents/index.js";
export { IntentIndexer } from "./intents/index.js";
export type { IntentIndexerOutput } from "./intents/index.js";
export { SignalIntakePackGenerator } from "./intents/index.js";
export type { IntakePackQuestion } from "./intents/index.js";
export {
  SignalIntakeOrchestrator,
  FALLBACK_WHO_QUESTION,
} from "./intents/index.js";
export type {
  IntakeAnswer,
  IntakeRound,
} from "./intents/index.js";
export { normalizeIntentDescription } from "./intents/index.js";
export { LensInferrer } from "./discovery/index.js";
export { NegotiationInsightsGenerator } from "./negotiations/index.js";
export type { NegotiationDigest } from "./negotiations/index.js";
export { IndexNegotiator } from "./negotiations/index.js";
export { NegotiationScreener } from "./negotiations/index.js";
export { NegotiationReflector } from "./negotiations/index.js";
export type { DistilledMemory, ReflectionTranscriptEntry, NegotiationReflectionInput, ChatReflectionInput, NegotiationReflectJobData, ReflectEnqueueFn } from "./negotiations/index.js";
export type { NegotiatorMemoryEntry } from "./negotiations/index.js";
export { QuestionerAgent } from "./questions/index.js";
export { isValidQuestionerInputContract } from "./questions/index.js";
export type { QuestionerInput, UptakeQuestionerInput, QuestionerEnqueuePayload, QuestionerEnqueueFn, PoolDiscoveryContext } from "./questions/index.js";
export { isQuestionerEnabled, isUptakeGuardEnabled, uptakeAuthorityThreshold, intentQuestionDailyCap, INTENT_QUESTION_DAILY_CAP_DEFAULT } from "./questions/index.js";
export { PoolDiscriminatorMiner } from "./opportunities/index.js";
export { PoolDiscriminatorAssigner } from "./opportunities/index.js";
export type { PoolDiscriminatorAssignmentInput, PoolDiscriminatorAssignedAxis } from "./opportunities/index.js";
export { runPoolDiscriminatorShadow } from "./opportunities/index.js";
export {
  poolQuestionsMiningMode,
  poolQuestionsMode,
  poolQuestionsPushMode,
  poolQuestionsStampNewborn,
  POOL_DISCRIMINATOR_MIN_POOL_SIZE,
  POOL_DISCRIMINATOR_MAX_CANDIDATES,
  POOL_DISCRIMINATOR_MAX_PUBLIC_CONTEXT_CHARS,
  POOL_QUESTION_MIN_VOI,
  POOL_QUESTION_MAX_PENDING_PER_INTENT,
} from "./opportunities/index.js";
export { poolQuestionsRanking, POOL_RERUN_DEBOUNCE_MS } from "./opportunities/index.js";

// Discovery env accessors (IND-XXX)
export { discoveryEvaluatorMinScore } from "./opportunities/index.js";
export { poolQuestionsVisitTrigger, POOL_VISIT_MINING_DEBOUNCE_MS } from "./opportunities/index.js";
export { buildPoolAdjustment, planPoolAdjustments, mergePoolAdjustment } from "./opportunities/index.js";
export type { PoolAdjustment, PoolAdjustmentSignal } from "./opportunities/index.js";
export { synthesizePoolQuestion, selectQuestionDiscriminators, toQuestionDiscriminator, BOTH_MATTER_LABEL } from "./opportunities/index.js";
export { poolQuestionCycleKey, buildPoolQuestionPushMessage } from "./opportunities/index.js";
export type { QuestionPoolDiscriminator, QuestionPoolSnapshot } from "./questions/index.js";
export type { PoolCandidate, DiscriminatorMiningInput, MinedDiscriminator } from "./opportunities/index.js";

// Lens C — negotiation-evidence questions (IND-433, shadow).
export { negotiationEvidenceQuestionsMode, NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES } from "./opportunities/index.js";
export { NegotiationEvidenceMiner } from "./opportunities/index.js";
export { runNegotiationEvidenceShadow } from "./opportunities/index.js";
export type { RawEvidenceTurn, RawEvidenceOutcome, RawEvidenceOwnerAnswer, RawEvidenceSegment } from "./opportunities/index.js";

// Lens B — outcome-question shadow (IND-434)
export { isOutcomeQuestionsActivated, OUTCOME_MIN_INDEPENDENT_EXAMPLES, OUTCOME_MAX_CANDIDATES, OUTCOME_MAX_PUBLIC_CONTEXT_CHARS } from "./opportunities/index.js";
export { runOutcomeShadow } from "./opportunities/index.js";
export type { OutcomeLabel, OutcomeExample, OutcomeShadowResult } from "./opportunities/index.js";
export { OpportunityEvaluator } from "./opportunities/index.js";
export type { EvaluatorInput } from "./opportunities/index.js";
export { OpportunityPresenter, gatherPresenterContext } from "./opportunities/index.js";
export type { PresenterDatabase } from "./opportunities/index.js";

// ─── Support utilities ────────────────────────────────────────────────────────

export { canUserSeeOpportunity, isActionableForViewer, validateOpportunityActors, classifyOpportunity, selectByComposition, RADAR_SOFT_TARGETS } from "./opportunities/index.js";
export { getPrimaryActionLabel } from "./opportunities/index.js";
export { computeRadarHealth } from "./opportunities/index.js";
export type { RadarHealthInput } from "./opportunities/index.js";
export { isIntroducerDiscoveryEnabled } from "./opportunities/index.js";
export { selectContactsForDiscovery, shouldRunIntroducerDiscovery, runIntroducerDiscovery, MAX_CONTACTS_PER_CYCLE, MAX_CANDIDATES_PER_CONTACT, INTRODUCER_DISCOVERY_SOURCE } from "./opportunities/index.js";
export type { IntroducerDiscoveryDatabase, IntroducerDiscoveryQueue, ContactWithIntents } from "./opportunities/index.js";
export { persistOpportunities } from "./opportunities/index.js";
export { presentOpportunity } from "./opportunities/index.js";
export type { UserInfo } from "./opportunities/index.js";
export { stripUuids, truncateAtBoundary } from "./opportunities/index.js";
export { stripUnsupportedOpportunityClaims } from "./opportunities/index.js";
export { safeFallbackSummary } from "./opportunities/index.js";
export { buildApiChatCardPresentationCacheKey, buildDeliveryCardPresentationCacheKey, buildRadarCardPresentationCacheKey } from "./opportunities/index.js";
export { getOrCreateDeliveryCardBatch } from "./opportunities/index.js";

// ─── Tools ────────────────────────────────────────────────────────────────────

export { createToolRegistry } from "./shared/agent/tool.registry.js";
// Capability-owned tool entry points. These are explicit, narrow contracts;
// capability implementation directories remain private to the package.
export { createEnrichmentTools } from "./contexts/index.js";
export type { EnrichmentToolDeps } from "./contexts/index.js";
export { AMBIENT_PARK_WINDOW_MS } from './negotiations/index.js';
export { normalizeTelegramHandle } from './shared/utils/telegram-handle.js';

// ─── MCP ──────────────────────────────────────────────────────────────────────

export { createMcpServer, buildMcpOnboardingMessage, ONBOARDING_ALLOWED } from "./mcp/mcp.server.js";
export type { ScopedDepsFactory } from "./mcp/mcp.server.js";
export { CANONICAL_MCP_CAPABILITY_POLICY_OPTIONS } from "./mcp/mcp.authorization-policy.js";
// `McpCapabilityPolicyOptions` types the fourth `createMcpServer` parameter and
// `McpAuthorizationDenialEvent` is the sole argument of the observer's
// `onCapabilityDenied`. Both are required to type a host's own composition, so
// they ship with the entry point rather than with the pruned policy internals.
export type {
  McpAuthorizationDenialEvent,
  McpAuthorizationObserver,
  McpCapabilityPolicyOptions,
} from "./mcp/mcp.authorization-policy.js";

// ─── States (for advanced graph consumers) ────────────────────────────────────
// @experimental — internal graph-state shapes; may change in a minor release.

export { NegotiationConsultationReasonSchema } from "./shared/schemas/negotiation-state.schema.js";
export type { UserNegotiationContext, NegotiationTurn, NegotiationOutcome, SeedAssessment } from "./shared/schemas/negotiation-state.schema.js";
export type { NegotiationAction, NegotiationConsultationReason, NegotiationSeat, NegotiationProtocolVersion } from "./shared/schemas/negotiation-state.schema.js";
export type { NegotiationGraphLike } from "./negotiations/index.js";
export {
  HERMES_OWNER_DIRECTIVE,
  HermesNegotiationResponseSchema,
  allowedHermesActionsFor,
  buildHermesNegotiationTurn,
} from "./negotiations/index.js";
export type {
  HermesNegotiationAction,
  HermesNegotiationResponse,
} from "./negotiations/index.js";

// ─── Negotiation seat rules (v2 client-advocate protocol) ───────────────────

export { isNegotiationTurnCapReached, expectedNegotiationSpeaker, allowedActionsFor, askUserAnswerWindowMs, configuredAskUserEnabled, isTerminalAction, isRejectLikeAction, readProtocolVersion, resolveSeat, seatViolationMessage } from "./negotiations/index.js";
export type { NegotiationSpeakerParticipants, NegotiationSpeakerMessage } from "./negotiations/index.js";
export { assessConsultationEligibility, consultationPromptFor, negotiationConsultationPolicyMode } from "./negotiations/index.js";
export type { ConsultationEligibility, ConsultationEligibilityInput, NegotiationConsultationPolicyMode } from "./negotiations/index.js";
export {
  NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
  NEGOTIATION_QUESTION_GENERIC_NETWORK,
  NEGOTIATION_QUESTION_GENERIC_UPTAKE_ACTIVITY,
  negotiationQuestionSettlementId,
} from "./negotiations/index.js";
