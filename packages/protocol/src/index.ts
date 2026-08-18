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
export type { QuestionerDatabase, PersistableQuestion, PersistedQuestion, QuestionFilters, ChatQuestionsHost } from "./questions/question.module.js";
export type { NegotiationSummaryReader } from "./shared/interfaces/negotiation-summary.interface.js";
export type { DiscoveryNegotiationDigest } from "./shared/schemas/negotiation-digest.schema.js";
export { NegotiationSummarizer } from "./negotiations/negotiation.module.js";
export type { ContactServiceAdapter } from "./contacts/contact.module.js";
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
export { SYSTEM_AGENT_IDS } from './agents/agent.module.js';

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
} from "./questions/question.module.js";
export type { PendingQuestionSummary } from "./shared/schemas/pending-question.schema.js";
export { McpApiKeyMetadataSchema } from "./shared/schemas/mcp-auth.schema.js";
export type {
  McpAuthInput,
  McpResolvedIdentity,
} from "./shared/schemas/mcp-auth.schema.js";
export type { DiscoveryNegotiation } from "./shared/schemas/discovery-question.schema.js";
export {
  QUESTION_BLOCK_MARKER,
  QUESTION_BLOCK_VERSION,
  QuestionBlockSchema,
  QuestionBlockQuestionSchema,
  parseQuestionMessage,
  serializeQuestionMessage,
  type QuestionBlock,
  type QuestionBlockQuestion,
  type ParsedQuestionMessage,
} from "./shared/schemas/question-block.schema.js";
export type { NetworkAssignmentMetadata } from "./shared/schemas/network-assignment.schema.js";
export { DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD, resolveAssignmentNetworkScope, buildNetworkAssignmentDecision } from "./shared/assignment/network-assignment.policy.js";

// ─── Graph factories ──────────────────────────────────────────────────────────

export { ChatGraphFactory } from "./agents/agent.module.js";
export { type ChatPersonaConfig } from "./agents/agent.module.js";
export { NEGOTIATOR_PERSONA_ID, createNegotiatorPersona } from "./agents/agent.module.js";
export {
  SIGNAL_PERSONA_ID,
  SIGNAL_PERSONA,
} from "./agents/agent.module.js";
export {
  ONBOARDING_PERSONA_ID,
  ONBOARDING_PERSONA,
} from "./agents/agent.module.js";
export { RadarGraphFactory } from "./opportunities/opportunity.module.js";
export { HydeGraphFactory } from "./discovery/index.js";
// ─── Networks ─────────────────────────────────────────────────────────────────
// The whole capability behind one class: the community lifecycle graph, the
// membership graph, signal assignment, and the agent-facing tools.

export { Networks } from "./networks/network.module.js";
export type {
  IntentNetworkIndexer,
  NetworksDeps,
  NetworkToolDeps,
} from "./networks/network.module.js";

// ─── Intents ──────────────────────────────────────────────────────────────────
// The whole capability behind one class: lifecycle graph, verification,
// network indexing, guided intake, and the agent-facing tools.

export { Intents } from "./intents/intent.module.js";
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
} from "./intents/intent.module.js";

export { MaintenanceGraphFactory } from "./maintenance/maintenance.graph.js";
export type { MaintenanceGraphDatabase, MaintenanceGraphCache, MaintenanceGraphQueue } from "./maintenance/maintenance.graph.js";
export { NegotiationGraphFactory, negotiateCandidates } from "./negotiations/negotiation.module.js";
export { OpportunityGraphFactory } from "./opportunities/opportunity.module.js";
export { hasUnsupportedOpportunityClaim } from "./opportunities/opportunity.module.js";
export type { StampNewbornOpportunitiesFn } from "./opportunities/opportunity.module.js";
export { bindOwnerApprovalProvenance } from "./opportunities/opportunity.module.js";
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
} from "./opportunities/opportunity.module.js";
export { EnrichmentGraphFactory } from "./contexts/context.module.js";
export { PremiseGraphFactory } from "./contexts/context.module.js";

// ─── Agents ───────────────────────────────────────────────────────────────────

export { UserContextGenerator } from "./contexts/context.module.js";
export { ChatTitleGenerator } from "./agents/agent.module.js";
export { ChatInterruptClassifier } from "./agents/agent.module.js";
export { ChatSummarizer } from "./agents/agent.module.js";
export { HydeGenerator } from "./discovery/index.js";
export { SuggestionGenerator } from "./agents/agent.module.js";
export { LensInferrer } from "./discovery/index.js";
export { NegotiationInsightsGenerator } from "./negotiations/negotiation.module.js";
export type { NegotiationDigest } from "./negotiations/negotiation.module.js";
export { IndexNegotiator } from "./negotiations/negotiation.module.js";
export { NegotiationScreener } from "./negotiations/negotiation.module.js";
export { NegotiationReflector } from "./negotiations/negotiation.module.js";
export type { DistilledMemory, ReflectionTranscriptEntry, NegotiationReflectionInput, ChatReflectionInput, NegotiationReflectJobData, ReflectEnqueueFn } from "./negotiations/negotiation.module.js";
export type { NegotiatorMemoryEntry } from "./negotiations/negotiation.module.js";
export type { NegotiatorClientDmMessage, NegotiatorClientDmQuery, NegotiatorClientDmRetrieveFn } from "./negotiations/negotiation.module.js";
export { QuestionerAgent } from "./questions/question.module.js";
export { isValidQuestionerInputContract } from "./questions/question.module.js";
export type { QuestionerInput, UptakeQuestionerInput, QuestionerEnqueuePayload, QuestionerEnqueueFn, PoolDiscoveryContext } from "./questions/question.module.js";
export { isQuestionerEnabled, intentQuestionDailyCap, INTENT_QUESTION_DAILY_CAP_DEFAULT } from "./questions/question.module.js";
export { PoolDiscriminatorMiner } from "./opportunities/opportunity.module.js";
export { PoolDiscriminatorAssigner } from "./opportunities/opportunity.module.js";
export type { PoolDiscriminatorAssignmentInput, PoolDiscriminatorAssignedAxis } from "./opportunities/opportunity.module.js";
export { runPoolDiscriminatorShadow } from "./opportunities/opportunity.module.js";
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
} from "./opportunities/opportunity.module.js";
export { poolQuestionsRanking, POOL_RERUN_DEBOUNCE_MS } from "./opportunities/opportunity.module.js";

// Discovery env accessors (IND-XXX)
export { discoveryEvaluatorMinScore } from "./opportunities/opportunity.module.js";
export { poolQuestionsVisitTrigger, POOL_VISIT_MINING_DEBOUNCE_MS } from "./opportunities/opportunity.module.js";
export { buildPoolAdjustment, planPoolAdjustments, mergePoolAdjustment } from "./opportunities/opportunity.module.js";
export type { PoolAdjustment, PoolAdjustmentSignal } from "./opportunities/opportunity.module.js";
export { synthesizePoolQuestion, selectQuestionDiscriminators, toQuestionDiscriminator, BOTH_MATTER_LABEL } from "./opportunities/opportunity.module.js";
export { poolQuestionCycleKey, buildPoolQuestionPushMessage } from "./opportunities/opportunity.module.js";
export type { QuestionPoolDiscriminator, QuestionPoolSnapshot } from "./questions/question.module.js";
export type { PoolCandidate, DiscriminatorMiningInput, MinedDiscriminator } from "./opportunities/opportunity.module.js";

// Lens C — negotiation-evidence questions (IND-433, shadow).
export { negotiationEvidenceQuestionsMode, NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES } from "./opportunities/opportunity.module.js";
export { NegotiationEvidenceMiner } from "./opportunities/opportunity.module.js";
export { runNegotiationEvidenceShadow } from "./opportunities/opportunity.module.js";
export type { RawEvidenceTurn, RawEvidenceOutcome, RawEvidenceOwnerAnswer, RawEvidenceSegment } from "./opportunities/opportunity.module.js";

// Lens B — outcome-question shadow (IND-434)
export { isOutcomeQuestionsActivated, OUTCOME_MIN_INDEPENDENT_EXAMPLES, OUTCOME_MAX_CANDIDATES, OUTCOME_MAX_PUBLIC_CONTEXT_CHARS } from "./opportunities/opportunity.module.js";
export { runOutcomeShadow } from "./opportunities/opportunity.module.js";
export type { OutcomeLabel, OutcomeExample, OutcomeShadowResult } from "./opportunities/opportunity.module.js";
export { OpportunityEvaluator } from "./opportunities/opportunity.module.js";
export type { EvaluatorInput } from "./opportunities/opportunity.module.js";
export { OpportunityPresenter, gatherPresenterContext } from "./opportunities/opportunity.module.js";
export type { PresenterDatabase } from "./opportunities/opportunity.module.js";

// ─── Support utilities ────────────────────────────────────────────────────────

export { canUserSeeOpportunity, isActionableForViewer, validateOpportunityActors, classifyOpportunity, selectByComposition, RADAR_SOFT_TARGETS } from "./opportunities/opportunity.module.js";
export { getPrimaryActionLabel } from "./opportunities/opportunity.module.js";
export { computeRadarHealth } from "./opportunities/opportunity.module.js";
export type { RadarHealthInput } from "./opportunities/opportunity.module.js";
export { isIntroducerDiscoveryEnabled } from "./opportunities/opportunity.module.js";
export { selectContactsForDiscovery, shouldRunIntroducerDiscovery, runIntroducerDiscovery, MAX_CONTACTS_PER_CYCLE, MAX_CANDIDATES_PER_CONTACT, INTRODUCER_DISCOVERY_SOURCE } from "./opportunities/opportunity.module.js";
export type { IntroducerDiscoveryDatabase, IntroducerDiscoveryQueue, ContactWithIntents } from "./opportunities/opportunity.module.js";
export { persistOpportunities } from "./opportunities/opportunity.module.js";
export { presentOpportunity } from "./opportunities/opportunity.module.js";
export type { UserInfo } from "./opportunities/opportunity.module.js";
export { stripUuids, truncateAtBoundary } from "./opportunities/opportunity.module.js";
export { stripUnsupportedOpportunityClaims } from "./opportunities/opportunity.module.js";
export { safeFallbackSummary } from "./opportunities/opportunity.module.js";
export { buildApiChatCardPresentationCacheKey, buildDeliveryCardPresentationCacheKey, buildRadarCardPresentationCacheKey } from "./opportunities/opportunity.module.js";
export { getOrCreateDeliveryCardBatch } from "./opportunities/opportunity.module.js";

// ─── Tools ────────────────────────────────────────────────────────────────────

export { createToolRegistry } from "./shared/agent/tool.registry.js";
// Capability-owned tool entry points. These are explicit, narrow contracts;
// capability implementation directories remain private to the package.
export { createEnrichmentTools } from "./contexts/context.module.js";
export type { EnrichmentToolDeps } from "./contexts/context.module.js";
export { AMBIENT_PARK_WINDOW_MS } from './negotiations/negotiation.module.js';
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
export type { NegotiationGraphLike } from "./negotiations/negotiation.module.js";
export {
  HERMES_OWNER_DIRECTIVE,
  HermesNegotiationResponseSchema,
  allowedHermesActionsFor,
  buildHermesNegotiationTurn,
} from "./negotiations/negotiation.module.js";
export type {
  HermesNegotiationAction,
  HermesNegotiationResponse,
} from "./negotiations/negotiation.module.js";

// ─── Negotiation seat rules (v2 client-advocate protocol) ───────────────────

export { isNegotiationTurnCapReached, expectedNegotiationSpeaker, negotiationScopeKey, readNegotiationMessages, allowedActionsFor, askUserAnswerWindowMs, configuredAskUserEnabled, isTerminalAction, isRejectLikeAction, readProtocolVersion, resolveSeat, seatViolationMessage } from "./negotiations/negotiation.module.js";
export type { NegotiationSpeakerParticipants, NegotiationSpeakerMessage, NegotiationScopeMetadata } from "./negotiations/negotiation.module.js";
export { assessConsultationEligibility, consultationPromptFor, negotiationConsultationPolicyMode } from "./negotiations/negotiation.module.js";
export type { ConsultationEligibility, ConsultationEligibilityInput, NegotiationConsultationPolicyMode } from "./negotiations/negotiation.module.js";
export {
  NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
  NEGOTIATION_QUESTION_GENERIC_NETWORK,
  NEGOTIATION_QUESTION_GENERIC_UPTAKE_ACTIVITY,
  negotiationQuestionSettlementId,
} from "./negotiations/negotiation.module.js";

// ─── Negotiation answer consumption (conversational questions) ──────────────

export {
  classifyParkedNegotiation,
  consumeQuestionBlockAnswers,
  negotiationParkAnswerId,
  resumeParkedNegotiation,
  routeAnswerRef,
} from "./negotiations/negotiation.module.js";
export type {
  AnswerRoute,
  InflightAnswerSettlementInput,
  InflightAnswerSettlementResult,
  NegotiationAnswerConsumptionPorts,
  NegotiationAnswerInput,
  NegotiationAnswerResumeOutcome,
  ParkClassification,
  QuestionBlockAnswerConsumptionInput,
  QuestionBlockAnswerConsumptionResult,
  RoutedAnswer,
} from "./negotiations/negotiation.module.js";
