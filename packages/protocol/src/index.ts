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
export { ChatContextAccessError, resolveChatContext } from "./internal/shared/agent/tool.helpers.js";
export { deriveAllowedNetworkIds, deriveDiscoveryNetworkIds } from "./internal/shared/agent/tool.scope.js";
export type { ToolScopeType, ScopeMembership } from "./protocol/scope.js";
export { requestContext } from "./internal/shared/observability/request-context.js";
export { setLoggerFactory } from "./internal/shared/observability/log.js";
export { setTimingWrapper } from "./internal/shared/observability/performance.js";
export { getToolTimeoutPolicy, invokeToolRuntime, toolRuntimeErrorToResult } from "./internal/shared/agent/tool.runtime.js";

// ─── Interfaces (implement these to wire up your infrastructure) ───────────────

export type { McpAuthResolver } from "./platform/auth.js";
export type { Cache, CacheOptions, HydeCache, OpportunityCache } from "./platform/cache.interface.js";
export type { ChatSummaryReader } from "./platform/chat-summary.js";
export type { NegotiationSummaryReader } from "./platform/negotiation-summary.js";
export type { DiscoveryNegotiationDigest } from "./protocol/schemas/negotiation-digest.schema.js";
export { NegotiationSummarizer } from "./internal/negotiations/negotiation.module.js";
export type { ContactServiceAdapter } from "./internal/contacts/contact.module.js";
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
export type { Embedder, VectorStoreOption, VectorSearchResult, HydeCandidate, HydeSearchOptions, LensEmbedding } from "./platform/embedder.js";
export type { IntentGraphQueue } from "./platform/queue.js";
export type { Scraper } from "./platform/scraper.js";
export type { EnrichmentRunInput, EnrichmentRunRecord } from "./platform/enrichment-run.js";
export type {
  NegotiationTimeoutQueue,
  AskUserExpiryPayload,
  NegotiationContinuationTimeoutIdentity,
} from "./platform/negotiation-events.js";
export type { AgentDispatcher, AgentDispatchResult, NegotiationTurnPayload } from "./internal/shared/interfaces/agent-dispatcher.interface.js";
export { SYSTEM_AGENT_IDS } from './internal/agents/agent.module.js';

// ─── Shared schemas ───────────────────────────────────────────────────────────

export { ChatContextDigestSchema, type ChatContextDigest } from "./protocol/schemas/chat-context.schema.js";
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
} from "./internal/questions/question.module.js";
export { McpApiKeyMetadataSchema } from "./platform/mcp-auth.schema.js";
export type {
  McpAuthInput,
  McpResolvedIdentity,
} from "./platform/mcp-auth.schema.js";
export type { DiscoveryNegotiation } from "./protocol/schemas/discovery-question.schema.js";
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
} from "./protocol/question-block.schema.js";
export type { NetworkAssignmentMetadata } from "./protocol/schemas/network-assignment.schema.js";
export type { IntentIndexingResult } from "./protocol/intent-indexing.js";
export type { HydeTargetCorpus, Lens } from "./protocol/lens.js";
export { DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD, resolveAssignmentNetworkScope, buildNetworkAssignmentDecision } from "./internal/shared/assignment/network-assignment.policy.js";

// ─── Graph factories ──────────────────────────────────────────────────────────

export { ChatGraphFactory } from "./internal/agents/agent.module.js";
export { type ChatPersonaConfig } from "./internal/agents/agent.module.js";
export { NEGOTIATOR_PERSONA_ID, createNegotiatorPersona } from "./internal/agents/agent.module.js";
// The shared self-identification helper: every surface that speaks AS the
// user's own agent introduces itself through this one sentence builder.
export { buildAgentSelfIntroduction, type AgentIdentityOptions } from "./internal/agents/agent.module.js";
export {
  SIGNAL_PERSONA_ID,
  createSignalPersona,
} from "./internal/agents/agent.module.js";
export {
  ONBOARDING_PERSONA_ID,
  createOnboardingPersona,
} from "./internal/agents/agent.module.js";
export { RadarGraphFactory } from "./internal/opportunities/opportunity.module.js";
export { HydeGraphFactory } from "./internal/discovery/index.js";
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

export { MaintenanceGraphFactory } from "./internal/maintenance/maintenance.graph.js";
export type { MaintenanceGraphDatabase, MaintenanceGraphCache, MaintenanceGraphQueue } from "./internal/maintenance/maintenance.graph.js";
export { NegotiationGraphFactory, negotiateCandidates } from "./internal/negotiations/negotiation.module.js";
export { OpportunityGraphFactory } from "./internal/opportunities/opportunity.module.js";
export { hasUnsupportedOpportunityClaim } from "./internal/opportunities/opportunity.module.js";
export type { StampNewbornOpportunitiesFn } from "./internal/opportunities/opportunity.module.js";
export { bindOwnerApprovalProvenance } from "./internal/opportunities/opportunity.module.js";
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
} from "./internal/opportunities/opportunity.module.js";
export { EnrichmentGraphFactory } from "./internal/contexts/context.module.js";
export { PremiseGraphFactory } from "./internal/contexts/context.module.js";

// ─── Agents ───────────────────────────────────────────────────────────────────

export { UserContextGenerator } from "./internal/contexts/context.module.js";
export { ChatTitleGenerator } from "./internal/agents/agent.module.js";
export { ChatInterruptClassifier } from "./internal/agents/agent.module.js";
export { ChatSummarizer } from "./internal/agents/agent.module.js";
export { HydeGenerator } from "./internal/discovery/index.js";
export { SuggestionGenerator } from "./internal/agents/agent.module.js";
export { LensInferrer } from "./internal/discovery/index.js";
export { NegotiationInsightsGenerator } from "./internal/negotiations/negotiation.module.js";
export type { NegotiationDigest } from "./internal/negotiations/negotiation.module.js";
export { IndexNegotiator } from "./internal/negotiations/negotiation.module.js";
export {
  QUESTION_BUDGET_PER_PRINCIPAL,
  assessAskAdmissibility,
  authorChecklist,
  checklistFromTurns,
  checklistVerdictState,
  configuredQuestionBudgetPerPrincipal,
  countPrincipalAskUserTurns,
  isChecklistAuthored,
  reconcileChecklist,
  renderChecklistSection,
} from "./internal/negotiations/negotiation.module.js";
export type {
  Answerhood,
  AskAdmissibility,
  AskInadmissibility,
  ChecklistItem,
  ChecklistKind,
  ChecklistResult,
  NegotiationChecklist,
} from "./internal/negotiations/negotiation.module.js";
export { NegotiationReflector } from "./internal/negotiations/negotiation.module.js";
export type { DistilledMemory, ReflectionTranscriptEntry, NegotiationReflectionInput, ChatReflectionInput, NegotiationReflectJobData, ReflectEnqueueFn } from "./internal/negotiations/negotiation.module.js";
export type { NegotiatorMemoryEntry } from "./internal/negotiations/negotiation.module.js";
export type { NegotiatorClientDmMessage, NegotiatorClientDmQuery, NegotiatorClientDmRetrieveFn } from "./internal/negotiations/negotiation.module.js";
export type { QuestionerInput, QuestionerEnqueuePayload, QuestionerEnqueueFn } from "./internal/questions/question.module.js";
export { INTENT_QUESTION_DAILY_CAP_DEFAULT } from "./internal/questions/question.module.js";
export { PoolDiscriminatorMiner } from "./internal/opportunities/opportunity.module.js";
export { PoolDiscriminatorAssigner } from "./internal/opportunities/opportunity.module.js";
export type { PoolDiscriminatorAssignmentInput, PoolDiscriminatorAssignedAxis } from "./internal/opportunities/opportunity.module.js";
export { runPoolDiscriminatorShadow } from "./internal/opportunities/opportunity.module.js";
export {
  POOL_DISCRIMINATOR_MIN_POOL_SIZE,
  POOL_DISCRIMINATOR_MAX_CANDIDATES,
  POOL_DISCRIMINATOR_MAX_PUBLIC_CONTEXT_CHARS,
  POOL_QUESTION_MIN_VOI,
  POOL_QUESTION_MAX_PENDING_PER_INTENT,
} from "./internal/opportunities/opportunity.module.js";
export { POOL_RERUN_DEBOUNCE_MS } from "./internal/opportunities/opportunity.module.js";

// Discovery env accessors (IND-XXX)
export { DISCOVERY_EVALUATOR_MIN_SCORE } from "./internal/opportunities/opportunity.module.js";
export { buildPoolAdjustment, planPoolAdjustments, mergePoolAdjustment } from "./internal/opportunities/opportunity.module.js";
export type { PoolAdjustment, PoolAdjustmentSignal } from "./internal/opportunities/opportunity.module.js";
export { synthesizePoolQuestion, selectQuestionDiscriminators, toQuestionDiscriminator, BOTH_MATTER_LABEL } from "./internal/opportunities/opportunity.module.js";
export { poolQuestionCycleKey, buildPoolQuestionPushMessage } from "./internal/opportunities/opportunity.module.js";
export type { QuestionPoolDiscriminator, QuestionPoolSnapshot } from "./internal/questions/question.module.js";
export type { PoolCandidate, DiscriminatorMiningInput, MinedDiscriminator } from "./internal/opportunities/opportunity.module.js";

// Lens C — negotiation-evidence questions (IND-433, shadow).
export { NEGOTIATION_EVIDENCE_QUESTIONS_MODE, NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES } from "./internal/opportunities/opportunity.module.js";
export { NegotiationEvidenceMiner } from "./internal/opportunities/opportunity.module.js";
export { runNegotiationEvidenceShadow } from "./internal/opportunities/opportunity.module.js";
export type { RawEvidenceTurn, RawEvidenceOutcome, RawEvidenceOwnerAnswer, RawEvidenceSegment } from "./internal/opportunities/opportunity.module.js";

// Lens B — outcome-question shadow (IND-434)
export { isOutcomeQuestionsActivated, OUTCOME_MIN_INDEPENDENT_EXAMPLES, OUTCOME_MAX_CANDIDATES, OUTCOME_MAX_PUBLIC_CONTEXT_CHARS } from "./internal/opportunities/opportunity.module.js";
export { runOutcomeShadow } from "./internal/opportunities/opportunity.module.js";
export type { OutcomeLabel, OutcomeExample, OutcomeShadowResult } from "./internal/opportunities/opportunity.module.js";
export { OpportunityEvaluator } from "./internal/opportunities/opportunity.module.js";
export type { EvaluatorInput } from "./internal/opportunities/opportunity.module.js";
export { OpportunityPresenter, gatherPresenterContext } from "./internal/opportunities/opportunity.module.js";
export type { PresenterDatabase } from "./internal/opportunities/opportunity.module.js";

// ─── Support utilities ────────────────────────────────────────────────────────

export { canUserSeeOpportunity, isActionableForViewer, validateOpportunityActors, classifyOpportunity, selectByComposition, RADAR_SOFT_TARGETS } from "./internal/opportunities/opportunity.module.js";
export { getPrimaryActionLabel } from "./internal/opportunities/opportunity.module.js";
export { computeRadarHealth } from "./internal/opportunities/opportunity.module.js";
export type { RadarHealthInput } from "./internal/opportunities/opportunity.module.js";
export { persistOpportunities } from "./internal/opportunities/opportunity.module.js";
export { presentOpportunity } from "./internal/opportunities/opportunity.module.js";
export type { UserInfo } from "./internal/opportunities/opportunity.module.js";
export { stripUuids, truncateAtBoundary } from "./internal/opportunities/opportunity.module.js";
export { stripUnsupportedOpportunityClaims } from "./internal/opportunities/opportunity.module.js";
export { safeFallbackSummary } from "./internal/opportunities/opportunity.module.js";
export { buildApiChatCardPresentationCacheKey, buildDeliveryCardPresentationCacheKey, buildRadarCardPresentationCacheKey } from "./internal/opportunities/opportunity.module.js";
export { getOrCreateDeliveryCardBatch } from "./internal/opportunities/opportunity.module.js";

// ─── Tools ────────────────────────────────────────────────────────────────────

export { createToolRegistry } from "./internal/shared/agent/tool.registry.js";
// Capability-owned tool entry points. These are explicit, narrow contracts;
// capability implementation directories remain private to the package.
export { createEnrichmentTools } from "./internal/contexts/context.module.js";
export type { EnrichmentToolDeps } from "./internal/contexts/context.module.js";
export { AMBIENT_PARK_WINDOW_MS } from './internal/negotiations/negotiation.module.js';
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
export type { NegotiationGraphLike } from "./internal/negotiations/negotiation.module.js";
export {
  HERMES_OWNER_DIRECTIVE,
  HermesNegotiationResponseSchema,
  allowedHermesActionsFor,
  buildHermesNegotiationTurn,
} from "./internal/negotiations/negotiation.module.js";
export type {
  HermesNegotiationAction,
  HermesNegotiationResponse,
} from "./internal/negotiations/negotiation.module.js";

// ─── Negotiation seat rules (v2 client-advocate protocol) ───────────────────

export { isNegotiationTurnCapReached, expectedNegotiationSpeaker, negotiationScopeKey, readNegotiationMessages, allowedActionsFor, ASK_USER_WINDOW_MS, isTerminalAction, isRejectLikeAction, readProtocolVersion, resolveSeat, seatViolationMessage } from "./internal/negotiations/negotiation.module.js";
export type { NegotiationSpeakerParticipants, NegotiationSpeakerMessage, NegotiationScopeMetadata } from "./internal/negotiations/negotiation.module.js";
export { assessConsultationEligibility, consultationPromptFor, NEGOTIATION_CONSULTATION_POLICY_MODE } from "./internal/negotiations/negotiation.module.js";
export type { ConsultationEligibility, ConsultationEligibilityInput, NegotiationConsultationPolicyMode } from "./internal/negotiations/negotiation.module.js";
// The pre-contact park predicate (#1445), re-exported for the radar read path:
// the "asking you first" state is the same open-consult recognition the
// per-signal cap performs, so both sides must read the stamp through one
// function rather than two copies of the same JSON walk.
export { countOpenPreContactConsults } from "./internal/negotiations/negotiation.module.js";
export type { PreContactConsultTaskRow } from "./internal/negotiations/negotiation.module.js";
export {
  NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
  NEGOTIATION_QUESTION_GENERIC_NETWORK,
  negotiationQuestionSettlementId,
} from "./internal/negotiations/negotiation.module.js";

// ─── Negotiation answer consumption (conversational questions) ──────────────

export {
  classifyInflightPark,
  classifyParkedNegotiation,
  classifyPostStallPark,
  consumeQuestionBlockAnswers,
  negotiationParkAnswerId,
  resumeParkedNegotiation,
  routeAnswerRef,
} from "./internal/negotiations/negotiation.module.js";
export type {
  AnswerRoute,
  InflightAnswerSettlementInput,
  InflightAnswerSettlementResult,
  NegotiationAnswerConsumptionPorts,
  NegotiationAnswerInput,
  NegotiationAnswerResumeOutcome,
  ParkClassification,
  ParkClassificationMessage,
  ParkClassificationTask,
  QuestionBlockAnswerConsumptionInput,
  QuestionBlockAnswerConsumptionResult,
  RoutedAnswer,
} from "./internal/negotiations/negotiation.module.js";
