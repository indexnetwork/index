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
export type { ChatSummaryReader, InChatNegotiationQuestionDelivery } from "./platform/chat/ports.js";
export type { NegotiationSummaryReader } from "./platform/negotiation/summary.js";
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
} from "./platform/database.js";
export type { Embedder, VectorStoreOption, VectorSearchResult, HydeCandidate, HydeSearchOptions, LensEmbedding } from "./platform/discovery/embedder.js";
export type { IntentGraphQueue } from "./platform/runtime/queue.js";
export type { Scraper } from "./platform/discovery/scraper.js";
export type { Logger, ProtocolError, ProtocolTraceEvent, RequestContext, RequestContextStore } from "./platform/runtime/observability.js";
export type { EnrichmentRunInput, EnrichmentRunRecord } from "./platform/enrichment/runs.js";
export type {
  NegotiationTimeoutQueue,
  AskUserExpiryPayload,
  NegotiationContinuationTimeoutIdentity,
} from "./platform/negotiation/events.js";
export type { AgentDispatcher, AgentDispatchResult, NegotiationTurnPayload } from "./internal/shared/interfaces/agent-dispatcher.interface.js";
export { SYSTEM_AGENT_IDS } from './internal/agents/agent.types.js';

// ─── Shared schemas ───────────────────────────────────────────────────────────

export { ChatContextDigestSchema, type ChatContextDigest } from "./protocol/schemas/chat-context.schema.js";
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
export { ASK_USER_LOCK_SLACK_MS, ASK_USER_WINDOW_MS, NEGOTIATION_MAX_TURNS_AMBIENT, NEGOTIATION_MAX_TURNS_CHAT } from "./protocol/core.js";

// ─── Personal agent chat ─────────────────────────────────────────────────────

export { PersonalAgentChat } from "./capabilities/agents.js";
export type { AgentsDeps as PersonalAgentChatDeps } from "./capabilities/agents.js";
export { HydeGraphFactory } from "./internal/discovery/hyde.graph.js";
export { Discovery } from "./capabilities/discovery.js";
export type { DiscoveryDeps } from "./capabilities/discovery.js";
// ─── Networks ─────────────────────────────────────────────────────────────────
// The whole capability behind one class: the community lifecycle graph, the
// membership graph, signal assignment, and the agent-facing tools.

export { Networks } from "./capabilities/networks.js";
export type {
  IntentNetworkIndexer,
  NetworksDeps,
  NetworkToolDeps,
} from "./capabilities/networks.js";
export { Contexts } from "./capabilities/contexts.js";
export type { ContextsDeps } from "./capabilities/contexts.js";
export { Opportunities } from "./capabilities/opportunities.js";
export type { OpportunitiesDeps } from "./capabilities/opportunities.js";
export { Negotiations } from "./capabilities/negotiations.js";
export type { NegotiationsDeps } from "./capabilities/negotiations.js";

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

export { MaintenanceGraphFactory } from "./internal/maintenance/maintenance.graph.js";
export type { MaintenanceGraphDatabase, MaintenanceGraphCache, MaintenanceGraphQueue } from "./internal/maintenance/maintenance.graph.js";
export { EnrichmentGraphFactory } from "./internal/enrichment/enrichment.graph.js";
export { PremiseGraphFactory } from "./internal/premises/premise.graph.js";

// ─── Agents ───────────────────────────────────────────────────────────────────

export { UserContextGenerator } from "./internal/contexts/context.generator.js";
export { ChatTitleGenerator } from "./internal/chat/chat.title.generator.js";
export { ChatInterruptClassifier } from "./internal/chat/chat.interrupt.classifier.js";
export { ChatSummarizer } from "./internal/chat/chat.summarizer.js";
export { HydeGenerator } from "./internal/discovery/hyde.generator.js";
export { SuggestionGenerator } from "./internal/chat/chat.suggester.js";
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

// ─── States (for advanced graph consumers) ────────────────────────────────────
// @experimental — internal graph-state shapes; may change in a minor release.

export { NegotiationConsultationReasonSchema } from "./protocol/schemas/negotiation-state.schema.js";
export type { UserNegotiationContext, NegotiationTurn, NegotiationOutcome, SeedAssessment } from "./protocol/schemas/negotiation-state.schema.js";
export type { NegotiationCounterpartyBinding } from "./platform/database.js";
export type { NegotiationAction, NegotiationConsultationReason, NegotiationSeat, NegotiationProtocolVersion } from "./protocol/schemas/negotiation-state.schema.js";

// ─── Negotiation compatibility exports ─────────────────────────────────────
/**
 * negotiation — the capability's sole cross-capability surface.
 *
 * Anything outside this capability imports from here and nowhere else.
 */
export { AMBIENT_PARK_WINDOW_MS, createNegotiationTools } from "./internal/negotiations/negotiation.tools.js";
export { createNegotiationAnswerTools } from "./internal/negotiations/negotiation.answer.tools.js";
export { buildLifecycleNarration, parkLifecycleLabel } from "./internal/negotiations/negotiation.lifecycle-narration.js";
export type { NegotiationLifecycleNarration, NegotiationParkNarration } from "./internal/negotiations/negotiation.lifecycle-narration.js";
export { buildFallbackDigest, NegotiationSummarizer } from "./internal/negotiations/negotiation.summarizer.js";
export { IndexNegotiator } from "./internal/negotiations/negotiation.agent.js";
export { negotiateCandidates, NegotiationGraphFactory } from "./internal/negotiations/negotiation.graph.js";
export { NegotiationInsightsGenerator } from "./internal/negotiations/insight.generator.js";
export { NegotiationReflector } from "./internal/negotiations/negotiation.reflect.js";
export type {
  ChatReflectionInput,
  DistilledMemory,
  NegotiationReflectionInput,
  NegotiationReflectJobData,
  ReflectEnqueueFn,
  ReflectionTranscriptEntry,
} from "./internal/negotiations/negotiation.reflect.js";
export type { NegotiationCandidate, OnNegotiationResolved } from "./internal/negotiations/negotiation.graph.js";
export type { NegotiationDigest } from "./internal/negotiations/insight.generator.js";

export {
  DEFAULT_NEGOTIATION_ASK_ROUNDS_CAP,
  allowedActionsFor,
  isRejectLikeAction,
  isTerminalAction,
  negotiationAskRoundsCap,
  readProtocolVersion,
  resolveSeat,
  seatViolationMessage,
} from "./internal/negotiations/negotiation.protocol.js";
export { countNegotiationAskRounds, countPrincipalAskUserTurns } from "./internal/negotiations/negotiation.graph.shared.js";
export {
  QUESTION_BUDGET_PER_PRINCIPAL,
  configuredQuestionBudgetPerPrincipal,
  MAX_CHECKLIST_DIMENSIONS,
  MIN_CHECKLIST_DIMENSIONS,
  NegotiationChecklistSchema,
  assessAskAdmissibility,
  authorChecklist,
  checklistFromTurns,
  checklistVerdictState,
  isChecklistAuthored,
  reconcileChecklist,
  renderChecklistSection,
} from "./internal/negotiations/negotiation.checklist.contracts.js";
export type {
  Answerhood,
  AskAdmissibility,
  AskInadmissibility,
  ChecklistItem,
  ChecklistKind,
  ChecklistResult,
  NegotiationChecklist,
} from "./internal/negotiations/negotiation.checklist.contracts.js";
export { NEGOTIATION_PARK_REASONING, NegotiationStallGapAuthor } from "./internal/negotiations/negotiation.stall-gap.js";
export type { NegotiationStallGap, NegotiationStallReason, StallGapAuthorInput } from "./internal/negotiations/negotiation.stall-gap.js";
export {
  HERMES_OWNER_DIRECTIVE,
  HERMES_SHARED_MESSAGE_TEMPLATES,
  HermesNegotiationActionSchema,
  HermesNegotiationResponseSchema,
  HermesOwnerDirectiveSchema,
  HermesRoleAlignmentSchema,
  allowedHermesActionsFor,
  buildHermesNegotiationTurn,
} from "./internal/negotiations/negotiation.hermes-contract.js";
export { DEFAULT_NEGOTIATION_MAX_TURNS, isNegotiationTurnCapReached } from "./internal/negotiations/negotiation.turn-cap.js";
export { MAX_CONSECUTIVE_TURN_FAILURES, appendTurnFailure, isTimeoutFailure, turnFailureBoundReached } from "./internal/negotiations/negotiation.turn-failure.js";
export type { NegotiationTurnFailure } from "./internal/negotiations/negotiation.turn-failure.js";
export { expectedNegotiationSpeaker } from "./internal/negotiations/negotiation.expected-speaker.js";
export { negotiationScopeKey, readNegotiationMessages } from "./internal/negotiations/negotiation.scope.js";
export {
  NEGOTIATION_CONSULTATION_POLICY_MODE,
  assessConsultationEligibility,
  consultationPromptFor,
  countOpenPreContactConsults,
} from "./internal/negotiations/negotiation.consultation-policy.js";
export {
  NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
  NEGOTIATION_QUESTION_GENERIC_NETWORK,
  isSafeAuthoredNegotiationQuestion,
  isSafeNegotiationQuestionText,
  negotiationQuestionSettlementId,
  validateInflightAskUserFields,
} from "./internal/negotiations/negotiation.question-safety.js";
export { renderNegotiatorChatMemorySection } from "./internal/negotiations/negotiation.memory.js";
export type {
  ConsultationEligibility,
  ConsultationEligibilityInput,
  NegotiationConsultationPolicyMode,
  PreContactConsultTaskRow,
} from "./internal/negotiations/negotiation.consultation-policy.js";
export type {
  HermesNegotiationAction,
  HermesNegotiationResponse,
  HermesOwnerDirective,
  HermesRoleAlignment,
} from "./internal/negotiations/negotiation.hermes-contract.js";
export type {
  NegotiationGraphLike,
} from "./internal/negotiations/negotiation.state.js";
export type { NegotiationSpeakerMessage, NegotiationSpeakerParticipants } from "./internal/negotiations/negotiation.expected-speaker.js";
export type { NegotiationScopeMetadata } from "./internal/negotiations/negotiation.scope.js";
export type { NegotiatorMemoryEntry } from "./internal/negotiations/negotiation.memory.js";
export type {
  NegotiatorClientDmMessage,
  NegotiatorClientDmQuery,
  NegotiatorClientDmRetrieveFn,
} from "./internal/negotiations/negotiation.client-dm.js";
export type { NegotiationToolDeps } from "./internal/negotiations/negotiation.tools.port.js";

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
  OpportunityEvaluator,
} from "./internal/opportunities/opportunity.evaluator.js";
export type {
  EvaluatorInput,
} from "./internal/opportunities/opportunity.evaluator.js";
export {
  OpportunityGraphFactory,
} from "./internal/opportunities/opportunity.graph.js";
export type {
  OpportunityGraphThresholdOverrides,
} from "./internal/opportunities/opportunity.graph.js";
export type {
  StampNewbornOpportunitiesFn,
  StampNewbornOpportunitiesInput,
} from "./internal/opportunities/opportunity.newborn-stamping.js";
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
  persistOpportunities,
} from "./internal/opportunities/opportunity.persist.js";
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
  DISCOVERY_EVALUATOR_MIN_SCORE,
  DISCOVERY_MIN_SIMILARITY,
  validateDiscoveryEvaluatorMinScore,
  validateDiscoveryMinSimilarity,
} from "./internal/opportunities/discovery.env.js";
export type {
} from "./internal/opportunities/discovery.env.js";
export {
  buildPoolAdjustment,
  mergePoolAdjustment,
  planPoolAdjustments,
} from "./internal/opportunities/discriminator/discriminator.adjustments.js";
export type {
  PoolAdjustment,
  PoolAdjustmentSignal,
} from "./internal/opportunities/discriminator/discriminator.adjustments.js";
export {
  PoolDiscriminatorAssigner,
} from "./internal/opportunities/discriminator/discriminator.assigner.js";
export type {
  PoolDiscriminatorAssignedAxis,
  PoolDiscriminatorAssignmentInput,
} from "./internal/opportunities/discriminator/discriminator.assigner.js";
export {
  PoolDiscriminatorMiner,
} from "./internal/opportunities/discriminator/discriminator.miner.js";
export {
  runPoolDiscriminatorShadow,
} from "./internal/opportunities/discriminator/discriminator.shadow.js";
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
export {
  computeRadarHealth,
} from "./internal/opportunities/radar/radar.health.js";
export type {
  RadarHealthInput,
} from "./internal/opportunities/radar/radar.health.js";
