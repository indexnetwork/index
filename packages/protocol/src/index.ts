// =============================================================================
// @indexnetwork/protocol — public API barrel
//
// This file is the ONLY supported entry point. Deep imports
// ("@indexnetwork/protocol/src/...") are not part of the contract and may break
// in any release. Every symbol is re-exported explicitly (no wildcards) so the
// surface is reviewable and changes are intentional.
//
// Stability tiers are defined in STABILITY.md. In short:
//   • Stable       — Interfaces, Graph factories, Agents, createChatTools,
//                    the tool/runtime helpers, and shared schemas.
//   • Experimental — Sections marked @experimental below (advanced graph state
//                    types and internal helpers); may change in a minor release.
// =============================================================================

// ─── Public API (recommended for external consumers) ──────────────────────────

export { createChatTools } from "./shared/agent/tool.factory.js";
export { getModelName } from "./shared/agent/model.config.js";
export type { ChatTools } from "./shared/agent/tool.factory.js";
export type { ModelConfig, ModelSettings } from "./shared/agent/model.config.js";
export type { ToolContext, ResolvedToolContext, ToolDeps, ProtocolDeps, RawToolDefinition, CompiledGraph } from "./shared/agent/tool.helpers.js";
export { ChatContextAccessError, resolveChatContext } from "./shared/agent/tool.helpers.js";
export {
  deriveAllowedNetworkIds,
  deriveDiscoveryNetworkIds,
  focusedNetworkId,
  focusedNetworkLabel,
  hasNetworkScope,
  scopeFromNetworkId,
} from "./shared/agent/tool.scope.js";
export type { ToolScopeEnvelope, ToolScopeType, ScopeMembership, DeriveNetworkScopeInput } from "./shared/agent/tool.scope.js";
export { requestContext } from "./shared/observability/request-context.js";
export { setLoggerFactory } from "./shared/observability/log.js";
export type { LoggerWithSource as ProtocolLoggerWithSource } from "./shared/observability/log.js";
export { setTimingWrapper } from "./shared/observability/performance.js";
export { ToolRuntimeError, getToolTimeoutPolicy, invokeToolRuntime, toolRuntimeErrorToResult } from "./shared/agent/tool.runtime.js";
export type { ToolRuntimeErrorCode, ToolTimeoutClass, ToolTimeoutPolicy } from "./shared/agent/tool.runtime.js";

// ─── Interfaces (implement these to wire up your infrastructure) ───────────────

export type { McpAuthResolver } from "./shared/interfaces/auth.interface.js";
export type { Cache, CacheOptions, HydeCache, OpportunityCache } from "./shared/interfaces/cache.interface.js";
export type { ChatSessionReader, ChatSessionDetail, ChatSessionSummary } from "./shared/interfaces/chat-session.interface.js";
export type { ChatSummaryReader } from "./shared/interfaces/chat-summary.interface.js";
export type { ChatMessageWriter } from "./shared/interfaces/chat-message-writer.interface.js";
export type { QuestionGeneratorReader } from "./shared/interfaces/question-generator.interface.js";
export type { QuestionerDatabase, PersistableQuestion, PersistedQuestion, QuestionFilters, ChatQuestionsHost, ChatQuestionAnswerOutcome } from "./shared/interfaces/questioner.interface.js";
export type { NegotiationSummaryReader } from "./shared/interfaces/negotiation-summary.interface.js";
export type { DiscoveryNegotiationDigest } from "./shared/schemas/negotiation-digest.schema.js";
export { NegotiationSummarizer, buildFallbackDigest } from "./negotiation/negotiation.summarizer.js";
export type { ContactServiceAdapter, ContactEntry, ContactImportResult, ContactInput, ContactResult, ContactSearchResult } from "./shared/interfaces/contact.interface.js";
export type {
  ChatGraphCompositeDatabase, UserDatabase, SystemDatabase, Database,
  OpportunityGraphDatabase, OpportunityControllerDatabase, HomeGraphDatabase,
  IntentGraphDatabase, IntentNetworkGraphDatabase, NetworkGraphDatabase, NetworkMembershipGraphDatabase,
  HydeGraphDatabase, EnrichmentGraphDatabase, PremiseGraphDatabase, NegotiationGraphDatabase,
  NegotiationQueries, NegotiationUserAnswer,
  Opportunity, OpportunityActor, OpportunityContext, OpportunityDetection, OpportunityInterpretation,
  OpportunityQueryOptions, OpportunitySignal, OpportunityStatus,
  ActiveIntent, CreatedIntent, CreateIntentData, UpdateIntentData, IntentRecord, SimilarIntent, SimilarIntentSearchOptions,
  IndexedIntentDetails, IndexMemberDetails, AssignmentNetworkMembership, NetworkAssignmentContext, NetworkMembership, OwnedIndex,
  CreateHydeDocumentData, HydeDocument, HydeSourceType, CreateOpportunityData,
  PremiseAnalysis, PremiseAssertion, PremiseProvenance, PremiseRecord, PremiseValidity,
  OnboardingPrivacyState, OnboardingProfileSeed, OnboardingState, PrivacyConsentDecision, PrivacyConsentSource,
  UpdateIndexSettingsData, UserRecord, UserSocial, ArchiveResult, Id,
} from "./shared/interfaces/database.interface.js";
export type {
  Embedder, EmbeddingGenerator, EmbeddingGenerateOptions,
  VectorStore, VectorStoreOption, VectorSearchResult,
  HydeCandidate, HydeSearchOptions, LensEmbedding,
} from "./shared/interfaces/embedder.interface.js";
export type { ProfileEnricher, EnrichmentRequest, EnrichmentResult } from "./shared/interfaces/enrichment.interface.js";
export type { IntegrationAdapter, IntegrationConnection, IntegrationSession, IntegrationSessionOptions, ToolActionResponse } from "./shared/interfaces/integration.interface.js";
export type { IntentGraphQueue } from "./shared/interfaces/queue.interface.js";
export type { Scraper, ExtractUrlContentOptions } from "./shared/interfaces/scraper.interface.js";
export type { Storage } from "./shared/interfaces/storage.interface.js";
export type { DeliveryLedger, DeliveredOpportunityRow } from "./shared/interfaces/delivery-ledger.interface.js";
export type { MintConnectLink, ConnectLinkKind } from "./shared/interfaces/connect-link.interface.js";
export type {
  DiscoveryRunStore, DiscoveryRunQueue, DiscoveryRunInput, CreateDiscoveryRunInput,
  DiscoveryRunRecord, DiscoveryRunStatus,
} from "./shared/interfaces/discovery-run.interface.js";
export type {
  EnrichmentRunStore, EnrichmentRunQueue, EnrichmentRunInput, CreateEnrichmentRunInput,
  UpdateUserEnrichmentRunInput, PreviewUserEnrichmentRunInput,
  EnrichmentRunRecord, EnrichmentRunStatus, EnrichmentRunOperation,
} from "./shared/interfaces/enrichment-run.interface.js";
export type { NegotiationTimeoutQueue, AskUserExpiryPayload } from "./shared/interfaces/negotiation-events.interface.js";
export type { AgentDispatcher, AgentDispatchResult, NegotiationTurnPayload } from "./shared/interfaces/agent-dispatcher.interface.js";
export type { AgentRecord, AgentTransportRecord, AgentPermissionRecord, AgentWithRelations, CreateAgentInput, CreateTransportInput, GrantPermissionInput, AgentDatabase } from './shared/interfaces/agent.interface.js';
export { SYSTEM_AGENT_IDS } from './shared/interfaces/agent.interface.js';

// ─── Shared schemas ───────────────────────────────────────────────────────────

export { ChatContextDigestSchema, type ChatContextDigest } from "./shared/schemas/chat-context.schema.js";
export { QuestionOptionSchema, QuestionSchema, UnderspecificationTypeSchema, QuestionStrategySchema, QuestionWithStrategySchema, QuestionGeneratorResponseSchema, QuestionModeSchema, QuestionDetectionSchema, QuestionActorSchema, QuestionAnswerSchema, type Question, type QuestionOption, type UnderspecificationType, type QuestionStrategy, type QuestionWithStrategy, type QuestionGeneratorResponse, type QuestionGenerationResult, type QuestionMode, type QuestionDetection, type QuestionActor, type QuestionAnswer } from "./shared/schemas/question.schema.js";
export type { PendingQuestionSummary } from "./shared/schemas/pending-question.schema.js";
export type { McpAuthInput } from "./shared/schemas/mcp-auth.schema.js";
export { UserIdentitySchema, type UserIdentity } from "./shared/schemas/identity.schema.js";
export type { DiscoverySourceProfile, DiscoverySummary, DiscoveryNegotiation, DiscoveryTurn, DiscoveryOutcome, DiscoveryQuestionInput, NegotiationRole } from "./shared/schemas/discovery-question.schema.js";
export { NetworkAssignmentResourceTypeSchema, NetworkAssignmentModeSchema, NetworkAssignmentScopeSchema, NetworkAssignmentPromptPresenceSchema, NetworkAssignmentPolicySchema, NetworkAssignmentRawScoresSchema, NetworkAssignmentMetadataSchema, OpportunityEvidenceKindSchema, OpportunityEvidenceSchema } from "./shared/schemas/network-assignment.schema.js";
export type { NetworkAssignmentResourceType, NetworkAssignmentMode, NetworkAssignmentScope, NetworkAssignmentPromptPresence, NetworkAssignmentPolicy, NetworkAssignmentRawScores, NetworkAssignmentMetadata, OpportunityEvidenceKind, OpportunityEvidence } from "./shared/schemas/network-assignment.schema.js";
export { DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD, classifyPromptPresence, resolveAssignmentNetworkScope, buildNetworkAssignmentDecision, combineAssignmentScores } from "./shared/assignment/network-assignment.policy.js";
export type { PromptPresenceInput, ResolveAssignmentNetworkScopeArgs, AssignmentScopeMembership, BuildNetworkAssignmentDecisionArgs, NetworkAssignmentDecision } from "./shared/assignment/network-assignment.policy.js";
export { buildCandidateEvidence, withCandidateEvidence, mergeOpportunityEvidence, withMatchedStrategies, renderOpportunityEvidenceForPrompt } from "./opportunity/opportunity.evidence.js";
export type { EvidenceCandidateInput } from "./opportunity/opportunity.evidence.js";

// ─── Intent clarification ─────────────────────────────────────────────────────

export { IntentClarifier, type IntentClarifierOutput } from "./intent/intent.clarifier.js";

// ─── Graph factories ──────────────────────────────────────────────────────────

export { ChatGraphFactory } from "./chat/chat.graph.js";
export {
  ORCHESTRATOR_PERSONA,
  ORCHESTRATOR_PERSONA_ID,
  type ChatPersonaConfig,
  type ChatPersonaLoopBehaviors,
} from "./chat/chat.persona.js";
export {
  NEGOTIATOR_PERSONA_ID,
  NEGOTIATOR_TOOL_NAMES,
  createNegotiatorPersona,
  createNegotiatorTools,
  filterNegotiatorTools,
} from "./chat/negotiator.persona.js";
export { buildNegotiatorSystemContent, type NegotiatorPromptOptions } from "./chat/negotiator.prompt.js";
export {
  NEGOTIATOR_MEMORY_TOOL_NAMES,
  createNegotiatorMemoryTools,
} from "./chat/negotiator.tools.js";
export type {
  NegotiatorMemoryToolsHost,
  NegotiatorMemoryRememberInput,
  NegotiatorMemoryToolView,
  NegotiatorMemoryForgetResult,
  RememberableMemoryKind,
} from "./shared/interfaces/negotiator-memory.interface.js";
export { HomeGraphFactory } from "./opportunity/feed/feed.graph.js";
export { HydeGraphFactory } from "./shared/hyde/hyde.graph.js";
export { NetworkGraphFactory } from "./network/network.graph.js";
export { NetworkMembershipGraphFactory } from "./network/membership/membership.graph.js";
export { IntentGraphFactory } from "./intent/intent.graph.js";
export { SemanticVerifier } from "./intent/intent.verifier.js";
export type { SemanticVerifierOutput } from "./intent/intent.verifier.js";
export { IntentNetworkGraphFactory } from "./network/indexer/indexer.graph.js";
export { MaintenanceGraphFactory } from "./maintenance/maintenance.graph.js";
export type { MaintenanceGraphDatabase, MaintenanceGraphCache, MaintenanceGraphQueue } from "./maintenance/maintenance.graph.js";
export { NegotiationGraphFactory, createDefaultNegotiationGraph, negotiateCandidates } from "./negotiation/negotiation.graph.js";
export { OpportunityGraphFactory } from "./opportunity/opportunity.graph.js";
export { EnrichmentGraphFactory } from "./enrichment/enrichment.graph.js";
export { PremiseGraphFactory } from "./premise/premise.graph.js";

// ─── Agents ───────────────────────────────────────────────────────────────────

export { UserContextGenerator } from "./context/context.generator.js";
export type { UserContextInput, IncrementalContextInput, UserContextResult, GlobalContextInput, GlobalIncrementalContextInput } from "./context/context.generator.js";
export { ChatTitleGenerator } from "./chat/chat.title.generator.js";
export { ChatInterruptClassifier } from "./chat/chat.interrupt.classifier.js";
export type { ClassifyInterruptInput } from "./chat/chat.interrupt.classifier.js";
export { ChatSummarizer } from "./chat/chat.summarizer.js";
export type { ChatSummarizerInput, ChatSummarizerMessage } from "./chat/chat.summarizer.js";
export { HydeGenerator } from "./shared/hyde/hyde.generator.js";
export { SuggestionGenerator } from "./chat/chat.suggester.js";
export type { SuggestionGeneratorInput } from "./chat/chat.suggester.js";
export { generateInviteMessage } from "./contact/contact.inviter.js";
export type { InviteInput, InviteOutput } from "./contact/contact.inviter.js";
export { IntentIndexer } from "./intent/intent.indexer.js";
export type { IntentIndexerOutput } from "./intent/intent.indexer.js";
export { PremiseAnalyzer } from "./premise/premise.analyzer.js";
export type { PremiseAnalyzerOutput } from "./premise/premise.analyzer.js";
export { PremiseDecomposer } from "./premise/premise.decomposer.js";
export type { PremiseDecomposerOutput, DecomposedPremise } from "./premise/premise.decomposer.js";
export { PremiseIndexer } from "./premise/premise.indexer.js";
export type { PremiseIndexerOutput } from "./premise/premise.indexer.js";
export { LensInferrer } from "./shared/hyde/lens.inferrer.js";
export { NegotiationInsightsGenerator } from "./negotiation/insight.generator.js";
export type { NegotiationDigest } from "./negotiation/insight.generator.js";
export { IndexNegotiator } from "./negotiation/negotiation.agent.js";
export { NegotiationScreener, configuredScreenMode, ScreenDecisionSchema, NEGOTIATION_SCREEN_MODES } from "./negotiation/negotiation.screen.js";
export type { ScreenDecision, ScreenDecisionRecord, NegotiationScreenMode, NegotiationScreenerInput } from "./negotiation/negotiation.screen.js";
export { NegotiationReflector, DistilledMemorySchema, ReflectionResultSchema, MAX_DISTILLED_MEMORIES, NEGOTIATOR_MEMORY_KINDS } from "./negotiation/negotiation.reflect.js";
export type { DistilledMemory, DistilledMemoryKind, ReflectionResult, ReflectionTranscriptEntry, NegotiationReflectionInput, ChatReflectionInput, NegotiationReflectJobData, ReflectEnqueueFn } from "./negotiation/negotiation.reflect.js";
export { renderNegotiatorMemorySection, renderNegotiatorChatMemorySection } from "./negotiation/negotiation.memory.js";
export type { NegotiatorMemoryEntry, NegotiatorMemoryQuery, NegotiatorMemoryScope, NegotiatorMemoryRetrieveFn } from "./negotiation/negotiation.memory.js";
export type { NegotiationAgentInput } from "./negotiation/negotiation.agent.js";
export { QuestionerAgent } from "./questioner/questioner.agent.js";
export type { QuestionerAgentConfig } from "./questioner/questioner.agent.js";
export type { QuestionerInput, QuestionerContext, QuestionerEnqueuePayload, QuestionerEnqueueFn, DiscoveryContext, IntentContext, ProfileContext, NegotiationContext, NegotiationInflightContext, ChatContext, PoolDiscoveryContext } from "./questioner/questioner.types.js";
export { getPreset } from "./questioner/questioner.presets.js";
export { QUD_UNDERSPECIFICATION_RULES } from "./questioner/questioner.qud.js";
export { isQuestionerEnabled, isDiscoveryQuestionsEnabled, discoveryQuestionsInputMode, discoveryQuestionsTimeoutMs, chatQuestionWaitTimeoutMs } from "./questioner/questioner.env.js";
export type { QuestionerPreset } from "./questioner/questioner.presets.js";
export { PoolDiscriminatorMiner } from "./opportunity/discriminator/discriminator.miner.js";
export type { PoolDiscriminatorMinerConfig } from "./opportunity/discriminator/discriminator.miner.js";
export { runPoolDiscriminatorShadow } from "./opportunity/discriminator/discriminator.shadow.js";
export type { DiscriminatorShadowInput } from "./opportunity/discriminator/discriminator.shadow.js";
export { scoreDiscriminator, computeNovelty, cosineSimilarity } from "./opportunity/discriminator/discriminator.scorer.js";
export { poolQuestionsMiningMode, poolQuestionsMode, POOL_DISCRIMINATOR_MIN_POOL_SIZE, POOL_DISCRIMINATOR_MAX_CANDIDATES, POOL_DISCRIMINATOR_MAX_PUBLIC_CONTEXT_CHARS, POOL_QUESTION_MIN_VOI, POOL_QUESTION_MIN_EVIDENCE_RATE, POOL_QUESTION_MAX_DISCRIMINATORS, POOL_QUESTION_MAX_PENDING_PER_INTENT } from "./opportunity/discriminator/discriminator.env.js";
export type { PoolQuestionsMiningMode, PoolQuestionsMode, PoolQuestionsRankingMode } from "./opportunity/discriminator/discriminator.env.js";
export { poolQuestionsRanking, POOL_ADJUSTMENT_FACTOR_OTHER, POOL_ADJUSTMENT_FACTOR_UNKNOWN, POOL_ADJUSTMENT_FLOOR, POOL_STALENESS_THRESHOLD, POOL_RERUN_DEBOUNCE_MS } from "./opportunity/discriminator/discriminator.env.js";
export { planPoolAdjustments, mergePoolAdjustment, removePoolAdjustment, readPoolAdjustments, poolAdjustmentMultiplier, adjustedConfidence, latestPoolDemotionDetail } from "./opportunity/discriminator/discriminator.adjustments.js";
export type { PoolAdjustment, PoolAdjustmentPlanEntry } from "./opportunity/discriminator/discriminator.adjustments.js";
export { synthesizePoolQuestion, selectQuestionDiscriminators, toQuestionDiscriminator, BOTH_MATTER_LABEL } from "./opportunity/discriminator/discriminator.question.js";
export type { SynthesizePoolQuestionInput, SynthesizedPoolQuestion } from "./opportunity/discriminator/discriminator.question.js";
export type { QuestionPoolAssignment, QuestionPoolDiscriminator, QuestionPoolSnapshot } from "./shared/schemas/question.schema.js";
export type { PoolCandidate, DiscriminatorMiningInput, MinedDiscriminator, ScoredDiscriminator, VerifiedAssignment, DiscriminatorShadowResult } from "./opportunity/discriminator/discriminator.types.js";
export { OpportunityEvaluator } from "./opportunity/opportunity.evaluator.js";
export type { EvaluatorInput, OpportunityEvaluatorOptionsConstructor } from "./opportunity/opportunity.evaluator.js";
export { OpportunityPresenter, gatherPresenterContext } from "./opportunity/opportunity.presenter.js";
export { createOpportunityTools } from "./opportunity/opportunity.tools.js";
export { createEnrichmentTools } from "./enrichment/enrichment.tools.js";
export type { PresenterDatabase } from "./opportunity/opportunity.presenter.js";
export { QuestionGenerator } from "./opportunity/question.generator.js";

// ─── Support utilities ────────────────────────────────────────────────────────

export { renderNetworkContext } from './shared/network/metadata.renderer.js';
export { canUserSeeOpportunity, isActionableForViewer, validateOpportunityActors, classifyOpportunity, selectByComposition, selectDigestCandidates, DIGEST_REDELIVERY_COOLDOWN_DAYS, FEED_SOFT_TARGETS } from "./opportunity/opportunity.utils.js";
export type { DigestDeliveredRow } from "./opportunity/opportunity.utils.js";
export { getPrimaryActionLabel } from "./opportunity/opportunity.labels.js";
export { computeFeedHealth } from "./opportunity/feed/feed.health.js";
export type { FeedHealthInput, FeedHealthResult } from "./opportunity/feed/feed.health.js";
export { selectContactsForDiscovery, shouldRunIntroducerDiscovery, runIntroducerDiscovery, MAX_CONTACTS_PER_CYCLE, MAX_CANDIDATES_PER_CONTACT, INTRODUCER_DISCOVERY_SOURCE } from "./opportunity/opportunity.introducer.js";
export type { IntroducerDiscoveryDatabase, IntroducerDiscoveryQueue, ContactWithIntents } from "./opportunity/opportunity.introducer.js";
export { persistOpportunities } from "./opportunity/opportunity.persist.js";
export { presentOpportunity } from "./opportunity/opportunity.presentation.js";
export type { UserInfo } from "./opportunity/opportunity.presentation.js";
export { stripUuids, stripIntroducerMentions, truncateAtBoundary } from "./opportunity/opportunity.presentation.js";
export { safeFallbackSummary, getSafePresentationOrSkip, SAFE_FALLBACK_MAX_CHARS, DEFAULT_FALLBACK_HEADLINE, DEFAULT_FALLBACK_ACTION, DEFAULT_EMPTY_FALLBACK_TEXT } from "./opportunity/opportunity.safe-presentation.js";
export type { SafeFallbackOptions, SafePresentation, SafePresentationOptions, SafePresentationSource } from "./opportunity/opportunity.safe-presentation.js";
export { getOrCreateDeliveryCardBatch, DELIVERY_CARD_CACHE_TTL, type CachedDeliveryCard, type OpportunityWithContext } from "./opportunity/delivery-card.cache.js";

// ─── Tools ────────────────────────────────────────────────────────────────────

export { createToolRegistry } from "./shared/agent/tool.registry.js";
export { createAgentTools } from './agent/agent.tools.js';
export { AMBIENT_PARK_WINDOW_MS } from './negotiation/negotiation.tools.js';
export { normalizeTelegramHandle } from './shared/utils/telegram-handle.js';

// ─── MCP ──────────────────────────────────────────────────────────────────────

export { createMcpServer, computeAgentAllowedNetworkIds, buildMcpOnboardingMessage, ONBOARDING_ALLOWED } from "./mcp/mcp.server.js";
export type { ScopedDepsFactory } from "./mcp/mcp.server.js";
export { buildElicitationCreate, flattenChoice } from "./mcp/elicitation.builder.js";
export { dispatchElicitations } from "./mcp/elicitation.dispatcher.js";
export type { ElicitResultLike, ElicitInputFn, DispatchElicitationsParams } from "./mcp/elicitation.dispatcher.js";

// ─── States (for advanced graph consumers) ────────────────────────────────────
// @experimental — internal graph-state shapes; may change in a minor release.

export type { UserNegotiationContext, NegotiationTurn, NegotiationOutcome, SeedAssessment } from "./shared/schemas/negotiation-state.schema.js";
export { NEGOTIATION_ACTIONS, AskUserPayloadSchema } from "./shared/schemas/negotiation-state.schema.js";
export type { NegotiationAction, NegotiationSeat, NegotiationProtocolVersion, AskUserPayload } from "./shared/schemas/negotiation-state.schema.js";
export type { NegotiationGraphLike } from "./negotiation/negotiation.state.js";

// ─── Negotiation seat rules (v2 client-advocate protocol) ───────────────────

export {
  InitiatorTurnSchema,
  CounterpartyTurnSchema,
  FinalInitiatorTurnSchema,
  FinalCounterpartyTurnSchema,
  InitiatorAskUserTurnSchema,
  CounterpartyAskUserTurnSchema,
  allowedActionsFor,
  turnSchemaFor,
  isTerminalAction,
  isRejectLikeAction,
  fallbackActionFor,
  rejectActionFor,
  readProtocolVersion,
  configuredProtocolVersion,
  configuredAskUserEnabled,
  askUserAnswerWindowMs,
  DEFAULT_ASK_USER_WINDOW_MS,
  ASK_USER_LOCK_SLACK_MS,
  resolveSeat,
  seatViolationMessage,
} from "./negotiation/negotiation.protocol.js";

// ─── Streamers ────────────────────────────────────────────────────────────────

export { ChatStreamer } from "./chat/chat.streamer.js";
export { ResponseStreamer } from "./shared/agent/response.streamer.js";
