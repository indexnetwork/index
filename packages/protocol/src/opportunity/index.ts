/**
 * opportunity — the capability's sole cross-capability surface.
 *
 * Anything outside this capability imports from here and nowhere else.
 * Supersedes the capabilities/*.facade.ts + opportunity/public/ pair; the export
 * list is the union of the facades it replaces, so the contract is unchanged.
 */
export {
  getOrCreateDeliveryCardBatch,
} from "./application/delivery-card.cache.js";
export {
  OpportunityEvaluator,
} from "./application/opportunity.evaluator.js";
export type {
  EvaluatorInput,
} from "./application/opportunity.evaluator.js";
export {
  OpportunityGraphFactory,
} from "./application/opportunity.graph.js";
export type {
  OpportunityGraphThresholdOverrides,
} from "./application/opportunity.graph.js";
export {
  isIntroducerDiscoveryEnabled,
} from "./application/opportunity.introducer-feature.js";
export {
  INTRODUCER_DISCOVERY_SOURCE,
  MAX_CANDIDATES_PER_CONTACT,
  MAX_CONTACTS_PER_CYCLE,
  runIntroducerDiscovery,
  selectContactsForDiscovery,
  shouldRunIntroducerDiscovery,
} from "./application/opportunity.introducer.js";
export type {
  ContactWithIntents,
  IntroducerDiscoveryDatabase,
  IntroducerDiscoveryQueue,
} from "./application/opportunity.introducer.js";
export type {
  StampNewbornOpportunitiesFn,
  StampNewbornOpportunitiesInput,
} from "./application/opportunity.newborn-stamping.js";
export {
  opportunityOwnerActionForStatus,
} from "./application/opportunity.owner-approval.js";
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
} from "./application/opportunity.owner-approval.js";
export {
  bindOwnerApprovalProvenance,
} from "./application/opportunity.owner-provenance.js";
export {
  persistOpportunities,
} from "./application/opportunity.persist.js";
export {
  gatherPresenterContext,
  OpportunityPresenter,
} from "./application/opportunity.presenter.js";
export type {
  PresenterDatabase,
} from "./application/opportunity.presenter.js";
export {
  createOpportunityTools,
} from "./application/opportunity.tools.js";
export {
  DISCOVERY_EVALUATOR_MIN_SCORE_DEFAULT,
  DISCOVERY_MIN_SIMILARITY_DEFAULT,
  discoveryAllowedTypes,
  discoveryEvaluatorMinScore,
  discoveryIntentMatchingEnabled,
  discoveryMinSimilarity,
  discoveryProfileMatchingEnabled,
  discoveryProfileSource,
  resetDiscoveryEnvWarningsForTests,
  validateDiscoveryEvaluatorMinScore,
  validateDiscoveryMinSimilarity,
} from "./discovery.env.js";
export type {
  DiscoveryMatchType,
  DiscoveryProfileSource,
} from "./discovery.env.js";
export {
  buildPoolAdjustment,
  mergePoolAdjustment,
  planPoolAdjustments,
} from "./discriminator/discriminator.adjustments.js";
export type {
  PoolAdjustment,
  PoolAdjustmentSignal,
} from "./discriminator/discriminator.adjustments.js";
export {
  PoolDiscriminatorAssigner,
} from "./discriminator/discriminator.assigner.js";
export type {
  PoolDiscriminatorAssignedAxis,
  PoolDiscriminatorAssignmentInput,
} from "./discriminator/discriminator.assigner.js";
export {
  POOL_DISCRIMINATOR_MAX_CANDIDATES,
  POOL_DISCRIMINATOR_MAX_PUBLIC_CONTEXT_CHARS,
  POOL_DISCRIMINATOR_MIN_POOL_SIZE,
  POOL_QUESTION_MAX_PENDING_PER_INTENT,
  POOL_QUESTION_MIN_VOI,
  POOL_RERUN_DEBOUNCE_MS,
  POOL_VISIT_MINING_DEBOUNCE_MS,
  poolQuestionsMiningMode,
  poolQuestionsMode,
  poolQuestionsPushMode,
  poolQuestionsRanking,
  poolQuestionsStampNewborn,
  poolQuestionsVisitTrigger,
} from "./discriminator/discriminator.env.js";
export {
  PoolDiscriminatorMiner,
} from "./discriminator/discriminator.miner.js";
export {
  buildPoolQuestionPushMessage,
  poolQuestionCycleKey,
} from "./discriminator/discriminator.push.js";
export {
  BOTH_MATTER_LABEL,
  selectQuestionDiscriminators,
  synthesizePoolQuestion,
  toQuestionDiscriminator,
} from "./discriminator/discriminator.question.js";
export {
  runPoolDiscriminatorShadow,
} from "./discriminator/discriminator.shadow.js";
export type {
  DiscriminatorMiningInput,
  MinedDiscriminator,
  PoolCandidate,
} from "./discriminator/discriminator.types.js";
export {
  hasUnsupportedOpportunityClaim,
  stripUnsupportedOpportunityClaims,
  stripUnsupportedOpportunityClaims as stripUnsupportedOpportunityClaimsText,
} from "../shared/utils/claim-safety.js";
export {
  buildCandidateEvidence,
} from "./domain/opportunity.evidence.js";
export {
  getPrimaryActionLabel,
} from "./domain/opportunity.labels.js";
export {
  buildApiChatCardPresentationCacheKey,
  buildDeliveryCardPresentationCacheKey,
  buildRadarCardPresentationCacheKey,
} from "./domain/opportunity.presentation-cache.js";
export {
  presentOpportunity,
  stripUuids,
  truncateAtBoundary,
} from "./domain/opportunity.presentation.js";
export type {
  UserInfo,
} from "./domain/opportunity.presentation.js";
export {
  DEFAULT_FALLBACK_HEADLINE,
  safeFallbackSummary,
} from "./domain/opportunity.safe-presentation.js";
export {
  canUserSeeOpportunity,
  classifyOpportunity,
  isActionableForViewer,
  RADAR_SOFT_TARGETS,
  selectByComposition,
  validateOpportunityActors,
} from "./domain/opportunity.utils.js";
export {
  NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES,
  negotiationEvidenceQuestionsMode,
} from "./negotiation-evidence/negotiation-evidence.env.js";
export {
  NegotiationEvidenceMiner,
} from "./negotiation-evidence/negotiation-evidence.miner.js";
export {
  runNegotiationEvidenceShadow,
} from "./negotiation-evidence/negotiation-evidence.shadow.js";
export type {
  RawEvidenceOutcome,
  RawEvidenceOwnerAnswer,
  RawEvidenceSegment,
  RawEvidenceTurn,
} from "./negotiation-evidence/negotiation-evidence.types.js";
export {
  isOutcomeQuestionsActivated,
  OUTCOME_MAX_CANDIDATES,
  OUTCOME_MAX_PUBLIC_CONTEXT_CHARS,
  OUTCOME_MIN_INDEPENDENT_EXAMPLES,
} from "./outcome/outcome.env.js";
export {
  runOutcomeShadow,
} from "./outcome/outcome.shadow.js";
export type {
  OutcomeExample,
  OutcomeLabel,
  OutcomeShadowResult,
} from "./outcome/outcome.types.js";
export type {
  OpportunityToolDeps,
} from "./ports/index.js";
export {
  RadarGraphFactory,
} from "./radar/radar.graph.js";
export {
  computeRadarHealth,
} from "./radar/radar.health.js";
export type {
  RadarHealthInput,
} from "./radar/radar.health.js";
