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
  CompiledGraph,
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
export type { QuestionGeneratorReader } from "./shared/interfaces/question-generator.interface.js";
export type { QuestionerDatabase, PersistableQuestion, PersistedQuestion, QuestionFilters, ChatQuestionsHost } from "./shared/interfaces/questioner.interface.js";
export type { NegotiationSummaryReader } from "./shared/interfaces/negotiation-summary.interface.js";
export type { DiscoveryNegotiationDigest } from "./shared/schemas/negotiation-digest.schema.js";
export { NegotiationSummarizer } from "./capabilities/negotiation.facade.js";
export type { ContactServiceAdapter } from "./shared/interfaces/contact.interface.js";
export type {
  ChatGraphCompositeDatabase,
  UserDatabase,
  AgentActivitySummary,
  SystemDatabase,
  OpportunityGraphDatabase,
  OpportunityControllerDatabase,
  OutcomeOutbox,
  HomeGraphDatabase,
  IntentGraphDatabase,
  HydeGraphDatabase,
  EnrichmentGraphDatabase,
  PremiseGraphDatabase,
  NegotiationGraphDatabase,
  NegotiationOpportunityLifecycle,
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
export type { IntegrationAdapter, IntegrationConnection, IntegrationSession, IntegrationSessionOptions, ToolActionResponse } from "./shared/interfaces/integration.interface.js";
export type { IntentGraphQueue } from "./shared/interfaces/queue.interface.js";
export type { Scraper } from "./shared/interfaces/scraper.interface.js";
export type { DiscoveryRunInput, DiscoveryRunRecord } from "./shared/interfaces/discovery-run.interface.js";
export type { EnrichmentRunInput, EnrichmentRunRecord } from "./shared/interfaces/enrichment-run.interface.js";
export type { NegotiationTimeoutQueue, AskUserExpiryPayload } from "./shared/interfaces/negotiation-events.interface.js";
export type { AgentDispatcher, AgentDispatchResult, NegotiationTurnPayload } from "./shared/interfaces/agent-dispatcher.interface.js";
export { SYSTEM_AGENT_IDS } from './shared/interfaces/agent.interface.js';

// ─── Shared schemas ───────────────────────────────────────────────────────────

export { ChatContextDigestSchema, type ChatContextDigest } from "./shared/schemas/chat-context.schema.js";
export {
  type Question,
  type UnderspecificationType,
  type QuestionStrategy,
  type QuestionGenerationResult,
  type QuestionPurpose,
  type NegotiationQuestionPurpose,
  type NegotiationQuestionCandidate,
  type NegotiationQuestionProvenance,
  NegotiationQuestionCandidateSchema,
  NegotiationQuestionProvenanceSchema,
  type QuestionPoolPush,
  type QuestionRecoverySnapshot,
  type QuestionVoidedReason,
  type QuestionPoolPushRequestStatus,
  type QuestionPoolPushRequestReason,
} from "./shared/schemas/question.schema.js";
export type { PendingQuestionSummary } from "./shared/schemas/pending-question.schema.js";
export {
  McpAuthInputSchema,
  McpApiKeyMetadataSchema,
  McpResolvedIdentitySchema,
} from "./shared/schemas/mcp-auth.schema.js";
export type {
  McpAuthInput,
  McpApiKeyMetadata,
  McpResolvedIdentity,
} from "./shared/schemas/mcp-auth.schema.js";
export type { DiscoverySummary, DiscoveryNegotiation, DiscoveryTurn, DiscoveryOutcome, DiscoveryQuestionInput, NegotiationRole } from "./shared/schemas/discovery-question.schema.js";
export type { NetworkAssignmentMetadata } from "./shared/schemas/network-assignment.schema.js";
export { DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD, resolveAssignmentNetworkScope, buildNetworkAssignmentDecision } from "./shared/assignment/network-assignment.policy.js";
export { buildCandidateEvidence } from "./capabilities/opportunities.facade.js";

// ─── Graph factories ──────────────────────────────────────────────────────────

export { ChatGraphFactory } from "./capabilities/participant-agents.facade.js";
export { ORCHESTRATOR_PERSONA_ID, type ChatPersonaConfig } from "./capabilities/participant-agents.facade.js";
export { NEGOTIATOR_PERSONA_ID, createNegotiatorPersona } from "./capabilities/participant-agents.facade.js";
export {
  SIGNAL_PERSONA_ID,
  SIGNAL_PERSONA,
  SIGNAL_NEW_SIGNAL_KICKOFF,
  SIGNAL_TOOL_NAMES,
  createSignalTools,
  filterSignalTools,
  narrowSignalTools,
} from "./capabilities/participant-agents.facade.js";
export {
  REPORTER_PERSONA_ID,
  REPORTER_PERSONA,
  REPORTER_BRIEFING_KICKOFF,
  REPORTER_TOOL_NAMES,
  createReporterTools,
  filterReporterTools,
  narrowReporterTools,
} from "./capabilities/participant-agents.facade.js";
export {
  ONBOARDING_PERSONA_ID,
  ONBOARDING_PERSONA,
  ONBOARDING_PROFILE_KICKOFF,
  ONBOARDING_TOOL_NAMES,
  createOnboardingTools,
  filterOnboardingTools,
  narrowOnboardingTools,
} from "./capabilities/participant-agents.facade.js";
export { HomeGraphFactory } from "./capabilities/opportunities.facade.js";
export { HydeGraphFactory } from "./capabilities/participant-context.facade.js";
export { NetworkGraphFactory } from "./capabilities/communities.facade.js";
export { NetworkMembershipGraphFactory } from "./capabilities/communities.facade.js";
export { IntentGraphFactory } from "./capabilities/signals.facade.js";
export { SemanticVerifier } from "./capabilities/signals.facade.js";
export { IntentNetworkGraphFactory } from "./capabilities/communities.facade.js";
export { MaintenanceGraphFactory } from "./capabilities/interaction-composition.facade.js";
export type { MaintenanceGraphDatabase, MaintenanceGraphCache, MaintenanceGraphQueue } from "./capabilities/interaction-composition.facade.js";
export { NegotiationGraphFactory, negotiateCandidates } from "./capabilities/negotiation.facade.js";
export { OpportunityGraphFactory } from "./capabilities/opportunities.facade.js";
export { hasUnsupportedOpportunityClaim } from "./capabilities/opportunities.facade.js";
export type { StampNewbornOpportunitiesFn } from "./capabilities/opportunities.facade.js";
export { EnrichmentGraphFactory } from "./capabilities/participant-context.facade.js";
export { PremiseGraphFactory } from "./capabilities/participant-context.facade.js";

// ─── Agents ───────────────────────────────────────────────────────────────────

export { UserContextGenerator } from "./capabilities/participant-context.facade.js";
export { ChatTitleGenerator } from "./capabilities/participant-agents.facade.js";
export { ChatInterruptClassifier } from "./capabilities/participant-agents.facade.js";
export { ChatSummarizer } from "./capabilities/participant-agents.facade.js";
export { HydeGenerator } from "./capabilities/participant-context.facade.js";
export { SuggestionGenerator } from "./capabilities/participant-agents.facade.js";
export { generateInviteMessage } from "./capabilities/contacts.facade.js";
export { IntentIndexer } from "./capabilities/signals.facade.js";
export type { IntentIndexerOutput } from "./capabilities/signals.facade.js";
export { LensInferrer } from "./capabilities/participant-context.facade.js";
export { NegotiationInsightsGenerator } from "./capabilities/negotiation.facade.js";
export type { NegotiationDigest } from "./capabilities/negotiation.facade.js";
export { IndexNegotiator } from "./capabilities/negotiation.facade.js";
export { NegotiationScreener } from "./capabilities/negotiation.facade.js";
export { NegotiationReflector } from "./capabilities/negotiation.facade.js";
export type { DistilledMemory, ReflectionTranscriptEntry, NegotiationReflectionInput, ChatReflectionInput, NegotiationReflectJobData, ReflectEnqueueFn } from "./capabilities/negotiation.facade.js";
export type { NegotiatorMemoryEntry } from "./capabilities/negotiation.facade.js";
export { QuestionerAgent } from "./capabilities/questions.facade.js";
export { isValidQuestionerInputContract } from "./capabilities/questions.facade.js";
export type { QuestionerInput, RecoveryQuestionerInput, UptakeQuestionerInput, PostStallQuestionerInput, InflightQuestionerInput, QuestionerEnqueuePayload, QuestionerEnqueueFn, PoolDiscoveryContext } from "./capabilities/questions.facade.js";
export { isQuestionerEnabled, isUptakeGuardEnabled, uptakeAuthorityThreshold } from "./capabilities/questions.facade.js";
export { PoolDiscriminatorMiner } from "./capabilities/opportunities.facade.js";
export { PoolDiscriminatorAssigner } from "./capabilities/opportunities.facade.js";
export type { PoolDiscriminatorAssignmentInput, PoolDiscriminatorAssignedAxis } from "./capabilities/opportunities.facade.js";
export { runPoolDiscriminatorShadow } from "./capabilities/opportunities.facade.js";
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
} from "./capabilities/opportunities.facade.js";
export { poolQuestionsRanking, POOL_RERUN_DEBOUNCE_MS } from "./capabilities/opportunities.facade.js";
export { poolQuestionsVisitTrigger, POOL_VISIT_MINING_DEBOUNCE_MS } from "./capabilities/opportunities.facade.js";
export { buildPoolAdjustment, planPoolAdjustments, mergePoolAdjustment } from "./capabilities/opportunities.facade.js";
export type { PoolAdjustment, PoolAdjustmentSignal } from "./capabilities/opportunities.facade.js";
export { synthesizePoolQuestion, selectQuestionDiscriminators, toQuestionDiscriminator, BOTH_MATTER_LABEL } from "./capabilities/opportunities.facade.js";
export { poolQuestionCycleKey, buildPoolQuestionPushMessage } from "./capabilities/opportunities.facade.js";
export type { QuestionPoolDiscriminator, QuestionPoolSnapshot } from "./shared/schemas/question.schema.js";
export type { PoolCandidate, DiscriminatorMiningInput, MinedDiscriminator } from "./capabilities/opportunities.facade.js";

// Lens C — negotiation-evidence questions (IND-433, shadow).
export { negotiationEvidenceQuestionsMode, NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES } from "./capabilities/opportunities.facade.js";
export { NegotiationEvidenceMiner } from "./capabilities/opportunities.facade.js";
export { runNegotiationEvidenceShadow } from "./capabilities/opportunities.facade.js";
export type { RawEvidenceTurn, RawEvidenceOutcome, RawEvidenceOwnerAnswer, RawEvidenceSegment } from "./capabilities/opportunities.facade.js";

// Lens B — outcome-question shadow (IND-434)
export { isOutcomeQuestionsActivated, OUTCOME_MIN_INDEPENDENT_EXAMPLES, OUTCOME_MAX_CANDIDATES, OUTCOME_MAX_PUBLIC_CONTEXT_CHARS } from "./capabilities/opportunities.facade.js";
export { runOutcomeShadow } from "./capabilities/opportunities.facade.js";
export type { OutcomeLabel, OutcomeExample, OutcomeShadowResult } from "./capabilities/opportunities.facade.js";
export { OpportunityEvaluator } from "./capabilities/opportunities.facade.js";
export type { EvaluatorInput } from "./capabilities/opportunities.facade.js";
export { OpportunityPresenter, gatherPresenterContext } from "./capabilities/opportunities.facade.js";
export type { PresenterDatabase } from "./capabilities/opportunities.facade.js";

// ─── Support utilities ────────────────────────────────────────────────────────

export { canUserSeeOpportunity, isActionableForViewer, validateOpportunityActors, classifyOpportunity, selectByComposition, FEED_SOFT_TARGETS } from "./capabilities/opportunities.facade.js";
export { getPrimaryActionLabel } from "./capabilities/opportunities.facade.js";
export { computeFeedHealth } from "./capabilities/opportunities.facade.js";
export type { FeedHealthInput } from "./capabilities/opportunities.facade.js";
export { selectContactsForDiscovery, shouldRunIntroducerDiscovery, runIntroducerDiscovery, MAX_CONTACTS_PER_CYCLE, MAX_CANDIDATES_PER_CONTACT, INTRODUCER_DISCOVERY_SOURCE } from "./capabilities/opportunities.facade.js";
export type { IntroducerDiscoveryDatabase, IntroducerDiscoveryQueue, ContactWithIntents } from "./capabilities/opportunities.facade.js";
export { persistOpportunities } from "./capabilities/opportunities.facade.js";
export { presentOpportunity } from "./capabilities/opportunities.facade.js";
export type { UserInfo } from "./capabilities/opportunities.facade.js";
export { stripUuids, truncateAtBoundary } from "./capabilities/opportunities.facade.js";
export { stripUnsupportedOpportunityClaims } from "./capabilities/opportunities.facade.js";
export { safeFallbackSummary } from "./capabilities/opportunities.facade.js";
export { buildApiChatCardPresentationCacheKey, buildDeliveryCardPresentationCacheKey, buildHomeCardPresentationCacheKey } from "./capabilities/opportunities.facade.js";
export { getOrCreateDeliveryCardBatch } from "./capabilities/opportunities.facade.js";

// ─── Tools ────────────────────────────────────────────────────────────────────

export { createToolRegistry } from "./shared/agent/tool.registry.js";
// Capability-owned tool entry points. These are explicit, narrow contracts;
// capability implementation directories remain private to the package.
export { createIntentTools } from "./capabilities/signals.facade.js";
export type { IntentToolDeps } from "./capabilities/signals.facade.js";
export { createEnrichmentTools, createPremiseTools } from "./capabilities/participant-context.facade.js";
export type { EnrichmentToolDeps, PremiseToolDeps } from "./capabilities/participant-context.facade.js";
export { createNetworkTools } from "./capabilities/communities.facade.js";
export type { NetworkToolDeps } from "./capabilities/communities.facade.js";
export { createOpportunityTools } from "./capabilities/opportunities.facade.js";
export type { OpportunityToolDeps } from "./capabilities/opportunities.facade.js";
export { createNegotiationTools } from "./capabilities/negotiation.facade.js";
export type { NegotiationToolDeps } from "./capabilities/negotiation.facade.js";
export { createQuestionerTools, createAskUserQuestionTools } from "./capabilities/questions.facade.js";
export type { AskUserQuestionToolDeps, QuestionerToolDeps } from "./capabilities/questions.facade.js";
export { createChatTools, createAgentTools } from "./capabilities/participant-agents.facade.js";
export type { AgentToolDeps } from "./capabilities/participant-agents.facade.js";
export { createContactTools } from "./capabilities/contacts.facade.js";
export type { ContactToolDeps } from "./capabilities/contacts.facade.js";
export { createIntegrationTools } from "./capabilities/integrations.facade.js";
export type { IntegrationToolDeps } from "./capabilities/integrations.facade.js";
export { AMBIENT_PARK_WINDOW_MS } from './capabilities/negotiation.facade.js';
export { normalizeTelegramHandle } from './shared/utils/telegram-handle.js';

// ─── MCP ──────────────────────────────────────────────────────────────────────

export { createMcpServer, buildMcpOnboardingMessage, ONBOARDING_ALLOWED } from "./mcp/mcp.server.js";
export type { ScopedDepsFactory } from "./mcp/mcp.server.js";
export {
  MCP_AGENT_ADMIN_TOOLS,
  CANONICAL_MCP_CAPABILITY_POLICY_OPTIONS,
  CANONICAL_MCP_TOOL_ACCESS_RULES,
  MCP_INFORMATIONAL_TOOLS,
  MCP_PERMISSION_ACTIONS,
  McpCapabilityPolicy,
  McpCapabilitySubjectSchema,
  McpPermissionActionSchema,
  McpPolicyAgentSnapshotSchema,
  McpPrincipalProfileSchema,
  McpToolPermissionRequirementSchema,
  McpToolAccessRuleSchema,
  defineMcpToolAccessRules,
  defineMcpToolPermissionMap,
  resolveMcpActivityCaller,
  resolveMcpCapabilitySubject,
} from "./mcp/mcp.authorization-policy.js";
export {
  ActivityQuestionCountsSchema,
  ActivityQuestionDomainSchema,
  ActivitySummaryDomainSchema,
  ActivitySummaryResponseSchema,
  McpActivityCallerSchema,
  QUESTION_MODE_TO_DOMAIN,
  READ_ACTIVITY_SUMMARY_TOOL_NAME,
  activitySummaryNetworkId,
  projectActivitySummary,
  resolveActivitySummaryDomains,
} from "./shared/agent/activity-projection.js";
export type {
  ActivityQuestionCounts,
  ActivityQuestionDomain,
  ActivitySummaryDomain,
  McpActivityCaller,
  ProjectedActivitySummary,
} from "./shared/agent/activity-projection.js";
export type {
  McpCapabilityDecision,
  McpCapabilityPolicyOptions,
  McpCapabilitySubject,
  McpPermissionAction,
  McpPolicyAgentSnapshot,
  McpPrincipalProfile,
  McpToolPermissionMap,
  McpToolPermissionRequirement,
  McpToolAccessRule,
  McpToolAccessRuleMap,
  ResolveMcpCapabilitySubjectInput,
} from "./mcp/mcp.authorization-policy.js";

// ─── States (for advanced graph consumers) ────────────────────────────────────
// @experimental — internal graph-state shapes; may change in a minor release.

export type { UserNegotiationContext, NegotiationTurn, NegotiationOutcome, SeedAssessment } from "./shared/schemas/negotiation-state.schema.js";
export type { NegotiationAction, NegotiationSeat, NegotiationProtocolVersion } from "./shared/schemas/negotiation-state.schema.js";
export type { NegotiationGraphLike } from "./capabilities/negotiation.facade.js";

// ─── Negotiation seat rules (v2 client-advocate protocol) ───────────────────

export { allowedActionsFor, isTerminalAction, isRejectLikeAction, readProtocolVersion, resolveSeat, seatViolationMessage } from "./capabilities/negotiation.facade.js";
export { assessConsultationEligibility, consultationPromptFor, negotiationConsultationPolicyMode } from "./capabilities/negotiation.facade.js";
export type { ConsultationEligibility, ConsultationEligibilityInput, NegotiationConsultationPolicyMode, NegotiationConsultationReason } from "./capabilities/negotiation.facade.js";
export {
  NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
  NEGOTIATION_QUESTION_GENERIC_NETWORK,
  NEGOTIATION_QUESTION_GENERIC_UPTAKE_ACTIVITY,
  isSafeNegotiationQuestionText,
  negotiationQuestionSettlementId,
  validateInflightAskUserFields,
} from "./capabilities/negotiation.facade.js";
