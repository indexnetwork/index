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
export type { ResolvedToolContext, ToolDeps, RawToolDefinition, CompiledGraph } from "./shared/agent/tool.helpers.js";
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
export { NegotiationSummarizer } from "./negotiation/negotiation.summarizer.js";
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
  type QuestionPoolPush,
  type QuestionRecoverySnapshot,
  type QuestionVoidedReason,
  type QuestionPoolPushRequestStatus,
  type QuestionPoolPushRequestReason,
} from "./shared/schemas/question.schema.js";
export type { PendingQuestionSummary } from "./shared/schemas/pending-question.schema.js";
export type { McpAuthInput } from "./shared/schemas/mcp-auth.schema.js";
export type { DiscoverySummary, DiscoveryNegotiation, DiscoveryTurn, DiscoveryOutcome, DiscoveryQuestionInput, NegotiationRole } from "./shared/schemas/discovery-question.schema.js";
export type { NetworkAssignmentMetadata } from "./shared/schemas/network-assignment.schema.js";
export { DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD, resolveAssignmentNetworkScope, buildNetworkAssignmentDecision } from "./shared/assignment/network-assignment.policy.js";
export { buildCandidateEvidence } from "./opportunity/opportunity.evidence.js";

// ─── Graph factories ──────────────────────────────────────────────────────────

export { ChatGraphFactory } from "./chat/chat.graph.js";
export { ORCHESTRATOR_PERSONA_ID, type ChatPersonaConfig } from "./chat/chat.persona.js";
export { NEGOTIATOR_PERSONA_ID, createNegotiatorPersona } from "./chat/negotiator.persona.js";
export {
  SIGNAL_PERSONA_ID,
  SIGNAL_PERSONA,
  SIGNAL_NEW_SIGNAL_KICKOFF,
  SIGNAL_TOOL_NAMES,
  createSignalTools,
  filterSignalTools,
  narrowSignalTools,
} from "./chat/signal.persona.js";
export {
  REPORTER_PERSONA_ID,
  REPORTER_PERSONA,
  REPORTER_BRIEFING_KICKOFF,
  REPORTER_TOOL_NAMES,
  createReporterTools,
  filterReporterTools,
  narrowReporterTools,
} from "./chat/reporter.persona.js";
export {
  ONBOARDING_PERSONA_ID,
  ONBOARDING_PERSONA,
  ONBOARDING_PROFILE_KICKOFF,
  ONBOARDING_TOOL_NAMES,
  createOnboardingTools,
  filterOnboardingTools,
  narrowOnboardingTools,
} from "./chat/onboarding.persona.js";
export { HomeGraphFactory } from "./opportunity/feed/feed.graph.js";
export { HydeGraphFactory } from "./shared/hyde/hyde.graph.js";
export { NetworkGraphFactory } from "./network/network.graph.js";
export { NetworkMembershipGraphFactory } from "./network/membership/membership.graph.js";
export { IntentGraphFactory } from "./intent/intent.graph.js";
export { SemanticVerifier } from "./intent/intent.verifier.js";
export { IntentNetworkGraphFactory } from "./network/indexer/indexer.graph.js";
export { MaintenanceGraphFactory } from "./maintenance/maintenance.graph.js";
export type { MaintenanceGraphDatabase, MaintenanceGraphCache, MaintenanceGraphQueue } from "./maintenance/maintenance.graph.js";
export { NegotiationGraphFactory, negotiateCandidates } from "./negotiation/negotiation.graph.js";
export { OpportunityGraphFactory } from "./opportunity/opportunity.graph.js";
export type { StampNewbornOpportunitiesFn } from "./opportunity/opportunity.graph.js";
export { EnrichmentGraphFactory } from "./enrichment/enrichment.graph.js";
export { PremiseGraphFactory } from "./premise/premise.graph.js";

// ─── Agents ───────────────────────────────────────────────────────────────────

export { UserContextGenerator } from "./context/context.generator.js";
export { ChatTitleGenerator } from "./chat/chat.title.generator.js";
export { ChatInterruptClassifier } from "./chat/chat.interrupt.classifier.js";
export { ChatSummarizer } from "./chat/chat.summarizer.js";
export { HydeGenerator } from "./shared/hyde/hyde.generator.js";
export { SuggestionGenerator } from "./chat/chat.suggester.js";
export { generateInviteMessage } from "./contact/contact.inviter.js";
export { IntentIndexer } from "./intent/intent.indexer.js";
export type { IntentIndexerOutput } from "./intent/intent.indexer.js";
export { LensInferrer } from "./shared/hyde/lens.inferrer.js";
export { NegotiationInsightsGenerator } from "./negotiation/insight.generator.js";
export type { NegotiationDigest } from "./negotiation/insight.generator.js";
export { IndexNegotiator } from "./negotiation/negotiation.agent.js";
export { NegotiationScreener } from "./negotiation/negotiation.screen.js";
export { NegotiationReflector } from "./negotiation/negotiation.reflect.js";
export type { DistilledMemory, ReflectionTranscriptEntry, NegotiationReflectionInput, ChatReflectionInput, NegotiationReflectJobData, ReflectEnqueueFn } from "./negotiation/negotiation.reflect.js";
export type { NegotiatorMemoryEntry } from "./negotiation/negotiation.memory.js";
export { QuestionerAgent } from "./questioner/questioner.agent.js";
export type { QuestionerInput, RecoveryQuestionerInput, UptakeQuestionerInput, QuestionerEnqueuePayload, QuestionerEnqueueFn, PoolDiscoveryContext } from "./questioner/questioner.types.js";
export { isQuestionerEnabled, isUptakeGuardEnabled, uptakeAuthorityThreshold } from "./questioner/questioner.env.js";
export { PoolDiscriminatorMiner } from "./opportunity/discriminator/discriminator.miner.js";
export { PoolDiscriminatorAssigner } from "./opportunity/discriminator/discriminator.assigner.js";
export type { PoolDiscriminatorAssignmentInput, PoolDiscriminatorAssignedAxis } from "./opportunity/discriminator/discriminator.assigner.js";
export { runPoolDiscriminatorShadow } from "./opportunity/discriminator/discriminator.shadow.js";
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
} from "./opportunity/discriminator/discriminator.env.js";
export { poolQuestionsRanking, POOL_RERUN_DEBOUNCE_MS } from "./opportunity/discriminator/discriminator.env.js";
export { poolQuestionsVisitTrigger, POOL_VISIT_MINING_DEBOUNCE_MS } from "./opportunity/discriminator/discriminator.env.js";
export { buildPoolAdjustment, planPoolAdjustments, mergePoolAdjustment } from "./opportunity/discriminator/discriminator.adjustments.js";
export type { PoolAdjustment, PoolAdjustmentSignal } from "./opportunity/discriminator/discriminator.adjustments.js";
export { synthesizePoolQuestion, selectQuestionDiscriminators, toQuestionDiscriminator, BOTH_MATTER_LABEL } from "./opportunity/discriminator/discriminator.question.js";
export { poolQuestionCycleKey, buildPoolQuestionPushMessage } from "./opportunity/discriminator/discriminator.push.js";
export type { QuestionPoolDiscriminator, QuestionPoolSnapshot } from "./shared/schemas/question.schema.js";
export type { PoolCandidate, DiscriminatorMiningInput, MinedDiscriminator } from "./opportunity/discriminator/discriminator.types.js";

// Lens C — negotiation-evidence questions (IND-433, shadow).
export { negotiationEvidenceQuestionsMode, NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES } from "./opportunity/negotiation-evidence/negotiation-evidence.env.js";
export { NegotiationEvidenceMiner } from "./opportunity/negotiation-evidence/negotiation-evidence.miner.js";
export { runNegotiationEvidenceShadow } from "./opportunity/negotiation-evidence/negotiation-evidence.shadow.js";
export type { RawEvidenceTurn, RawEvidenceOutcome, RawEvidenceOwnerAnswer, RawEvidenceSegment } from "./opportunity/negotiation-evidence/negotiation-evidence.types.js";

// Lens B — outcome-question shadow (IND-434)
export { isOutcomeQuestionsActivated, OUTCOME_MIN_INDEPENDENT_EXAMPLES, OUTCOME_MAX_CANDIDATES, OUTCOME_MAX_PUBLIC_CONTEXT_CHARS } from "./opportunity/outcome/outcome.env.js";
export { runOutcomeShadow } from "./opportunity/outcome/outcome.shadow.js";
export type { OutcomeLabel, OutcomeExample, OutcomeShadowResult } from "./opportunity/outcome/outcome.types.js";
export { OpportunityEvaluator } from "./opportunity/opportunity.evaluator.js";
export type { EvaluatorInput } from "./opportunity/opportunity.evaluator.js";
export { OpportunityPresenter, gatherPresenterContext } from "./opportunity/opportunity.presenter.js";
export { createOpportunityTools } from "./opportunity/opportunity.tools.js";
export { createEnrichmentTools } from "./enrichment/enrichment.tools.js";
export type { PresenterDatabase } from "./opportunity/opportunity.presenter.js";

// ─── Support utilities ────────────────────────────────────────────────────────

export { canUserSeeOpportunity, isActionableForViewer, validateOpportunityActors, classifyOpportunity, selectByComposition, FEED_SOFT_TARGETS } from "./opportunity/opportunity.utils.js";
export { getPrimaryActionLabel } from "./opportunity/opportunity.labels.js";
export { computeFeedHealth } from "./opportunity/feed/feed.health.js";
export type { FeedHealthInput } from "./opportunity/feed/feed.health.js";
export { selectContactsForDiscovery, shouldRunIntroducerDiscovery, runIntroducerDiscovery, MAX_CONTACTS_PER_CYCLE, MAX_CANDIDATES_PER_CONTACT, INTRODUCER_DISCOVERY_SOURCE } from "./opportunity/opportunity.introducer.js";
export type { IntroducerDiscoveryDatabase, IntroducerDiscoveryQueue, ContactWithIntents } from "./opportunity/opportunity.introducer.js";
export { persistOpportunities } from "./opportunity/opportunity.persist.js";
export { presentOpportunity } from "./opportunity/opportunity.presentation.js";
export type { UserInfo } from "./opportunity/opportunity.presentation.js";
export { stripUuids, truncateAtBoundary } from "./opportunity/opportunity.presentation.js";
export { stripUnsupportedOpportunityClaims } from "./opportunity/opportunity.claim-safety.js";
export { safeFallbackSummary } from "./opportunity/opportunity.safe-presentation.js";
export { buildApiChatCardPresentationCacheKey, buildDeliveryCardPresentationCacheKey, buildHomeCardPresentationCacheKey } from "./opportunity/opportunity.presentation-cache.js";
export { getOrCreateDeliveryCardBatch } from "./opportunity/delivery-card.cache.js";

// ─── Tools ────────────────────────────────────────────────────────────────────

export { createToolRegistry } from "./shared/agent/tool.registry.js";
export { AMBIENT_PARK_WINDOW_MS } from './negotiation/negotiation.tools.js';
export { normalizeTelegramHandle } from './shared/utils/telegram-handle.js';

// ─── MCP ──────────────────────────────────────────────────────────────────────

export { createMcpServer, buildMcpOnboardingMessage, ONBOARDING_ALLOWED } from "./mcp/mcp.server.js";
export type { ScopedDepsFactory } from "./mcp/mcp.server.js";

// ─── States (for advanced graph consumers) ────────────────────────────────────
// @experimental — internal graph-state shapes; may change in a minor release.

export type { UserNegotiationContext, NegotiationTurn, NegotiationOutcome, SeedAssessment } from "./shared/schemas/negotiation-state.schema.js";
export type { NegotiationAction, NegotiationSeat, NegotiationProtocolVersion } from "./shared/schemas/negotiation-state.schema.js";
export type { NegotiationGraphLike } from "./negotiation/negotiation.state.js";

// ─── Negotiation seat rules (v2 client-advocate protocol) ───────────────────

export { allowedActionsFor, isTerminalAction, isRejectLikeAction, readProtocolVersion, resolveSeat, seatViolationMessage } from "./negotiation/negotiation.protocol.js";

